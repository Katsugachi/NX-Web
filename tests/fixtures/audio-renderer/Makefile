ifeq ($(strip $(DEVKITPRO)),)
$(error Set DEVKITPRO to your devkitPro installation)
endif

LIBNX := $(DEVKITPRO)/libnx
CC := $(DEVKITPRO)/devkitA64/bin/aarch64-none-elf-gcc
CFLAGS := -O2 -Wall -Wextra -D__SWITCH__ -march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE -I$(LIBNX)/include
LDFLAGS := -specs=$(LIBNX)/switch.specs -L$(LIBNX)/lib

.PHONY: all clean
all: audio-renderer.nro

audio-renderer.elf: source/main.c
	$(CC) $(CFLAGS) $< $(LDFLAGS) -lnx -o $@

audio-renderer.nro: audio-renderer.elf
	$(DEVKITPRO)/tools/bin/elf2nro $< $@

clean:
	rm -f audio-renderer.elf audio-renderer.nro
