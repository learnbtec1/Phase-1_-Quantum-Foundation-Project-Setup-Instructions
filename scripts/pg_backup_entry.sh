#!/bin/sh
# Strips Windows CRLF from bind-mounted script before the shell parses it.
# (Docker Desktop on Windows can surface pg_backup.sh with \r; sh then errors:
#  "set: illegal option -" and ": not found" on the line with set -eu)
tr -d "$(printf '\r')" < /pg_backup.sh | sh -s
