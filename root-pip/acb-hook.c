/* Race Weekend C9 ACB registration adapter; MAIN owns audio, SUB is manual. */
#include <dlfcn.h>
#include <stdint.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "lease.h"
#define RW_SUB_MANUAL_DASS 1

typedef struct LSMessage LSMessage;
typedef struct json_object json_object;
static volatile int cache_lock;
static void lock_cache(void) { while (__sync_lock_test_and_set(&cache_lock, 1)) {} }
static void unlock_cache(void) { __sync_lock_release(&cache_lock); }
static const char *(*get_payload)(LSMessage *);
static const char *(*get_method)(LSMessage *);
static json_object *(*jparse)(const char *);
static int (*jget)(json_object *, const char *, json_object **);
static const char *(*jstring)(json_object *);
static int (*jint)(json_object *);
static void (*jadd)(json_object *, const char *, json_object *);
static json_object *(*jnewstring)(const char *);
static json_object *(*jnewbool)(int);
static const char *(*jserialize)(json_object *);
static int (*jput)(json_object *);

/* Payloads live until the owning LsMsgWrapper destructor. AcbService is a
 * hash-pinned non-PIE executable: its D1/D0 destructor calls LSMessageUnref
 * with return addresses 0x51742/0x5175a. Other LS2 references are untouched.
 * A bounded cache also fails closed against unusually many concurrent requests.
 */
#define CACHE_SIZE 128
#define MAX_PAYLOAD 16384
static struct { LSMessage *message; char *original; char *rewritten; } cache[CACHE_SIZE];
static void log_line(const char *text) { (void)text; }

static int init_json(void)
{
    if (jparse) return jget && jstring && jint && jadd && jnewstring && jnewbool && jserialize && jput;
    jget = dlsym(RTLD_NEXT, "json_object_object_get_ex");
    jstring = dlsym(RTLD_NEXT, "json_object_get_string");
    jint = dlsym(RTLD_NEXT, "json_object_get_int");
    jadd = dlsym(RTLD_NEXT, "json_object_object_add");
    jnewstring = dlsym(RTLD_NEXT, "json_object_new_string");
    jnewbool = dlsym(RTLD_NEXT, "json_object_new_boolean");
    jserialize = dlsym(RTLD_NEXT, "json_object_to_json_string");
    jput = dlsym(RTLD_NEXT, "json_object_put");
    jparse = dlsym(RTLD_NEXT, "json_tokener_parse");
    return jparse && jget && jstring && jint && jadd && jnewstring && jnewbool && jserialize && jput;
}

static const char *rewritten_payload(LSMessage *message)
{
    if (!get_payload) get_payload = dlsym(RTLD_NEXT, "LSMessageGetPayload");
    if (!get_method) get_method = dlsym(RTLD_NEXT, "LSMessageGetMethod");
    const char *payload = get_payload ? get_payload(message) : 0;
    if (!payload || !rw_lease_active()) return payload;
    const char *method = get_method ? get_method(message) : 0;
    if (!method || strcmp(method, "register") || !init_json()) return payload;
    size_t size = strlen(payload);
    if (size > MAX_PAYLOAD) return payload;
    int slot = -1, index;
    for (index = 0; index < CACHE_SIZE; ++index) {
        if (cache[index].message == message) {
            if (!strcmp(cache[index].original, payload)) return cache[index].rewritten;
            free(cache[index].original); free(cache[index].rewritten);
            memset(&cache[index], 0, sizeof(cache[index]));
            slot = index; break;
        }
        if (!cache[index].message && slot < 0) slot = index;
    }
    if (slot < 0) return payload;
    json_object *root = jparse(payload), *value = 0, *geometry = 0;
    if (!root) return payload;
    if (!jget(root, "appId", &value) || !jstring(value) ||
        strcmp(jstring(value), "com.ravboni.raceweekend")) {
        jput(root); return payload;
    }
    if (!jget(root, "displayOutput", &geometry) || !jget(geometry, "width", &value) || jint(value) <= 0) {
        log_line("register unchanged: absent/invalid displayOutput.width");
        jput(root); return payload;
    }
    int sub = jint(value) <= 640;
    json_object *sink = jnewstring(sub ? "sub" : "main");
    json_object *purpose = jnewstring("multi view");
    json_object *dual = jnewbool(1);
    json_object *window = sub ? jparse("{\"purpose\":\"multiView\",\"windowMode\":\"pip\"}") : 0;
#ifdef RW_SUB_MANUAL_DASS
    json_object *audio_action = sub ? jnewstring("manual") : 0;
    json_object *audio_mute = sub ? jnewbool(1) : 0;
    if (sub && (!audio_action || !audio_mute)) {
        if (audio_action) jput(audio_action);
        if (audio_mute) jput(audio_mute);
        if (sink) jput(sink);
        if (purpose) jput(purpose);
        if (dual) jput(dual);
        if (window) jput(window);
        jput(root); return payload;
    }
#endif
    if (!sink || !purpose || !dual || (sub && !window)) {
        if (sink) jput(sink);
        if (purpose) jput(purpose);
        if (dual) jput(dual);
        if (window) jput(window);
#ifdef RW_SUB_MANUAL_DASS
        if (audio_action) jput(audio_action);
        if (audio_mute) jput(audio_mute);
#endif
        jput(root); return payload;
    }
    jadd(root, "vsmSinkType", sink);
    jadd(root, "purpose", purpose);
    jadd(root, "isDualMode", dual);
    if (sub) jadd(root, "subWindowInfo", window);
#ifdef RW_SUB_MANUAL_DASS
    if (sub) {
        jadd(root, "dassAction", audio_action);
        jadd(root, "muteAudio", audio_mute);
    }
#endif
    const char *serialized = jserialize(root);
    char *result = serialized ? malloc(strlen(serialized) + 1) : 0;
    if (result) memcpy(result, serialized, strlen(serialized) + 1);
    jput(root);
    if (!result) return payload;
#ifdef RW_SUB_MANUAL_DASS
    log_line(sub ? "register routed SUB, dual=true, dassAction=manual, muteAudio=true" : "register routed MAIN, dual=true, audio preserved");
#else
    log_line(sub ? "register routed SUB, dual=true, audio preserved" : "register routed MAIN, dual=true, audio preserved");
#endif
    char *original_copy = malloc(size + 1);
    if (!original_copy) { free(result); return payload; }
    memcpy(original_copy, payload, size + 1);
    cache[slot].message = message;
    cache[slot].original = original_copy;
    cache[slot].rewritten = result;
    return result;
}

__attribute__((visibility("default")))
const char *LSMessageGetPayload(LSMessage *message)
{
    lock_cache();
    const char *result = rewritten_payload(message);
    unlock_cache();
    return result;
}

/* Free only at the examined ACB wrapper's lifetime boundary, not an arbitrary
 * LS2 Unref (the message may have several references). The registration handler
 * already copied/parsed this payload into its JsonWrapper by this point. */
__attribute__((visibility("default")))
void LSMessageUnref(LSMessage *message)
{
    static void (*original_unref)(LSMessage *);
    uintptr_t caller = (uintptr_t)__builtin_return_address(0) & ~(uintptr_t)1;
    if (caller == 0x51742 || caller == 0x5175a) {
        lock_cache();
        int index;
        for (index = 0; index < CACHE_SIZE; ++index) {
            if (cache[index].message == message) {
                free(cache[index].original);
                free(cache[index].rewritten);
                memset(&cache[index], 0, sizeof(cache[index]));
                break;
            }
        }
        unlock_cache();
    }
    if (!original_unref) original_unref = dlsym(RTLD_NEXT, "LSMessageUnref");
    if (original_unref) original_unref(message);
}
