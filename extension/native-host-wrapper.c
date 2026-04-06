/*
 * Tiny native messaging host launcher.
 * Chrome on macOS requires a Mach-O binary, not a script.
 * This just execs node with the real native-host.js.
 */
#include <unistd.h>
#include <libgen.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {
    /* Resolve path to native-host.js next to this binary */
    char self[4096];
    char script[4096];

    /* Use argv[0] dirname + native-host.js */
    strncpy(self, argv[0], sizeof(self) - 1);
    self[sizeof(self) - 1] = '\0';
    char *dir = dirname(self);
    snprintf(script, sizeof(script), "%s/native-host.js", dir);

    /* Path to node — set at compile time via -DNODE_PATH=... */
#ifndef NODE_PATH
#error "NODE_PATH must be defined at compile time: cc -DNODE_PATH='\"$(which node)\"' ..."
#endif
    const char *node = NODE_PATH;

    execl(node, "node", script, (char *)NULL);

    /* If exec fails, log and exit */
    perror("execl failed");
    return 1;
}
