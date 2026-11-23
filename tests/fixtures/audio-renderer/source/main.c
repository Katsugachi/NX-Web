// SPDX-License-Identifier: GPL-3.0-or-later
#include <malloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <switch.h>

enum { Frames = 1024, Channels = 2, Rate = 44100, Bytes = Frames * Channels * sizeof(s16) };

static void report(const char *stage, unsigned failures, unsigned queued, u32 played) {
    char text[160];
    int len = snprintf(text, sizeof(text), "AUDIO_RENDERER %s failures=%u queued=%u played=%u\n",
                       stage, failures, queued, played);
    svcOutputDebugString(text, len);
}

static void check(Result result) {
    if (R_FAILED(result)) {
        report("API_ERROR", 1, 0, result);
        exit(1);
    }
}

int main(void) {
    const AudioRendererConfig config = {
        .output_rate = AudioRendererOutputRate_48kHz,
        .num_voices = Channels, .num_effects = 0, .num_sinks = 1,
        .num_mix_objs = 1, .num_mix_buffers = Channels,
    };
    AudioDriver driver;
    check(audrenInitialize(&config));
    check(audrvCreate(&driver, &config, Channels));
    s16 *pool = memalign(0x1000, Bytes * 2);
    if (!pool) { report("ALLOC_ERROR", 1, 0, 0); return 1; }
    memset(pool, 0, Bytes * 2);
    int pool_id = audrvMemPoolAdd(&driver, pool, Bytes * 2);
    if (pool_id < 0 || !audrvMemPoolAttach(&driver, pool_id)) {
        report("POOL_ERROR", 1, 0, 0); return 1;
    }
    const u8 channels[] = {0, 1};
    audrvDeviceSinkAdd(&driver, AUDREN_DEFAULT_DEVICE_NAME, Channels, channels);
    if (!audrvVoiceInit(&driver, 0, Channels, PcmFormat_Int16, Rate)) {
        report("VOICE_ERROR", 1, 0, 0); return 1;
    }
    audrvVoiceSetDestinationMix(&driver, 0, AUDREN_FINAL_MIX_ID);
    audrvVoiceSetMixFactor(&driver, 0, 1.0f, 0, 0);
    audrvVoiceSetMixFactor(&driver, 0, 1.0f, 1, 1);
    audrvVoiceStart(&driver, 0);
    check(audrenStartAudioRenderer());
    for (unsigned i = 0; i < 5; ++i) {
        check(audrvUpdate(&driver));
        audrenWaitFrame();
    }
    unsigned failures = audrvVoiceGetPlayedSampleCount(&driver, 0) != 0;
    report("empty", failures, 0, audrvVoiceGetPlayedSampleCount(&driver, 0));

    AudioDriverWaveBuf buffers[2] = {0};
    bool observed_playing[2] = {false};
    bool submitted[2] = {false};
    for (unsigned i = 0; i < 2; ++i) {
        buffers[i].data_raw = pool;
        buffers[i].size = Bytes * 2;
        buffers[i].start_sample_offset = i * Frames;
        buffers[i].end_sample_offset = (i + 1) * Frames;
        for (unsigned j = 0; j < Frames; ++j) {
            s16 sample = (j % 100) < 50 ? 6000 : -6000;
            pool[(i * Frames + j) * Channels] = sample;
            pool[(i * Frames + j) * Channels + 1] = sample;
        }
    }
    armDCacheFlush(pool, Bytes * 2);
    unsigned queued = 0;
    unsigned paused_at = 0;
    const u64 start = armGetSystemTick();
    while (armTicksToNs(armGetSystemTick() - start) < 30000000000ULL) {
        for (unsigned i = 0; i < 2; ++i) {
            if (buffers[i].state == AudioDriverWaveBufState_Playing)
                observed_playing[i] = true;
            if (buffers[i].state == AudioDriverWaveBufState_Free ||
                buffers[i].state == AudioDriverWaveBufState_Done) {
                if (submitted[i] && !observed_playing[i]) ++failures;
                observed_playing[i] = false;
                submitted[i] = true;
                if (!audrvVoiceAddWaveBuf(&driver, 0, &buffers[i])) ++failures;
                ++queued;
            }
        }
        check(audrvUpdate(&driver));
        for (unsigned i = 0; i < 2; ++i) {
            if (buffers[i].state == AudioDriverWaveBufState_Playing)
                observed_playing[i] = true;
        }
        if (queued / 32 > paused_at) {
            paused_at = queued / 32;
            svcSleepThread(80000000);
        }
        audrenWaitFrame();
    }
    if (audrvVoiceGetPlayedSampleCount(&driver, 0) < Rate * 20) ++failures;
    report("result", failures, queued, audrvVoiceGetPlayedSampleCount(&driver, 0));
    while (appletMainLoop()) svcSleepThread(100000000);
    audrvClose(&driver);
    audrenExit();
    free(pool);
    return failures != 0;
}
