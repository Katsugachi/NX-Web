ifeq ($(strip $(DEVKITPRO)),)
$(error Set DEVKITPRO to your devkitPro installation)
endif

LIBNX := $(DEVKITPRO)/libnx
PORTLIBS := $(DEVKITPRO)/portlibs/switch
CC := $(DEVKITPRO)/devkitA64/bin/aarch64-none-elf-gcc
CFLAGS := -O2 -Wall -Wextra -D__SWITCH__ -march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE -I$(LIBNX)/include -I$(PORTLIBS)/include
LDFLAGS := -specs=$(LIBNX)/switch.specs -L$(PORTLIBS)/lib -L$(LIBNX)/lib

.PHONY: all clean
all: gl-instancing.nro

gl-instancing.elf: source/main.c
	$(CC) $(CFLAGS) $< $(LDFLAGS) -lglad -lEGL -lglapi -ldrm_nouveau -lstdc++ -lnx -lm -o $@

gl-instancing.nro: gl-instancing.elf
	$(DEVKITPRO)/tools/bin/elf2nro $< $@

clean:
	rm -f gl-instancing.elf gl-instancing.nro
