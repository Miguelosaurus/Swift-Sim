#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  char *end = NULL;
  errno = 0;
  long parsed = strtol(argv[1], &end, 10);
  if (errno != 0 || end == argv[1] || *end != '\0' || parsed <= 1) return 65;

  pid_t pid = (pid_t)parsed;
  struct proc_bsdinfo info;
  memset(&info, 0, sizeof(info));
  int info_size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  if (info_size != (int)sizeof(info)) return 66;

  char executable[PROC_PIDPATHINFO_MAXSIZE];
  memset(executable, 0, sizeof(executable));
  if (proc_pidpath(pid, executable, sizeof(executable)) <= 0) return 67;

  printf("%" PRIu64 ".%06" PRIu64 "\n%u\n%s\n",
         info.pbi_start_tvsec,
         info.pbi_start_tvusec,
         info.pbi_pgid,
         executable);
  return 0;
}
