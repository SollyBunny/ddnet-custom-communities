#!/bin/sh

if command -v tcc >/dev/null 2>&1; then
    CC=tcc
else
    CC=cc
fi

"$CC" scripts/check-imgs/*.c -o check-imgs -lz && exec ./check-imgs
