/* C9 libcbe b9c5827a... only. Scoped to Race Weekend, not all WAM players.
 * applicationId() disassembly reads the C++ string at 0x534/0x538.
 * RenderFrameImpl::GetRenderView() returns the RenderView base at impl +640.
 * The control program verifies the complete libcbe hash before loading this.
 */
#include <dlfcn.h>
#include <stdint.h>
#include <string.h>
#include "lease.h"
#define APP "com.ravboni.raceweekend"
typedef void (*previous_fn)(void *, void *);
static int is_app_view(void *view)
{
    if (!view) return 0;
    uint32_t pointer = 0, length = 0;
    memcpy(&pointer, (char *)view + 0x534, sizeof(pointer));
    memcpy(&length, (char *)view + 0x538, sizeof(length));
    return pointer && length == sizeof(APP) - 1 && !memcmp((const void *)(uintptr_t)pointer, APP, length);
}
static void *delegate_view(void *self)
{
    static void *(*frame_for)(void *);
    static void *(*view_for)(void *);
    if (!frame_for) frame_for = dlsym(RTLD_NEXT, "_ZNK7content19RenderFrameObserver12render_frameEv");
    if (!view_for) view_for = dlsym(RTLD_NEXT, "_ZN7content15RenderFrameImpl13GetRenderViewEv");
    if (!frame_for || !view_for) return 0;
    void *frame = frame_for(self);
    void *base = frame ? view_for(frame) : 0;
    return base ? (char *)base - 640 : 0;
}
#define HOOK(symbol, view_expression) \
__attribute__((visibility("default"))) void symbol(void *self, void *player) { \
    static previous_fn original; \
    if (rw_lease_active() && is_app_view(view_expression)) return; \
    if (!original) original = (previous_fn)dlsym(RTLD_NEXT, #symbol); \
    if (original) original(self, player); \
}
HOOK(_ZN5media30RendererWebMediaPlayerDelegate22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE, delegate_view(self))
HOOK(_ZThn16_N5media30RendererWebMediaPlayerDelegate22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE, delegate_view((char *)self - 16))
HOOK(_ZN7content14RenderViewImpl22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE, self)
HOOK(_ZThn640_N7content14RenderViewImpl22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE, (char *)self - 640)
