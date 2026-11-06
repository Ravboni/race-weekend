/* Shared fail-closed gate: only a root-owned, unexpired session can opt in. */
#ifndef RW_PIP_LEASE_H
#define RW_PIP_LEASE_H
#include <fcntl.h>
#include <sys/stat.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
#ifndef RW_PIP_LEASE
#define RW_PIP_LEASE "/tmp/race-weekend-pip/lease"
#endif
#if defined(__arm__)
/* C9 glibc exports the versioned pre-glibc-2.33 stat ABI. Build with time32. */
extern int __fxstat(int, int, struct stat *);
#define RW_FSTAT(fd, st) __fxstat(3, fd, st)
#else
#define RW_FSTAT(fd, st) fstat(fd, st)
#endif
static int rw_lease_active(void)
{
    struct stat st;
    char value[32];
    int fd = open(RW_PIP_LEASE, O_RDONLY | O_NOFOLLOW);
    if (fd < 0) return 0;
    if (RW_FSTAT(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid != 0 || (st.st_mode & 0022)) {
        close(fd); return 0;
    }
    ssize_t length = read(fd, value, sizeof(value) - 1);
    close(fd);
    if (length <= 0) return 0;
    value[length] = 0;
    time_t now = time(0);
    unsigned long expiry = strtoul(value, 0, 10);
    return now > 0 && expiry > (unsigned long)now && expiry <= (unsigned long)now + 15;
}
#endif
