#!/bin/sh
# Backend failure must not block nginx startup.
if [ -x /usr/local/bin/bun ]; then
	/usr/local/bin/bun /app/server/debug.ts &
fi
exec /usr/local/bin/modern-ui-entrypoint "$@"
