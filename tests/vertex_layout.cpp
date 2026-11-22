// SPDX-License-Identifier: GPL-3.0-or-later

#include <cassert>
#include <iostream>

#include "video_core/renderer_webgpu/wgpu_vertex_layout.h"

int main() {
    using WebGPU::NeedsVertexPulling;
    assert(!NeedsVertexPulling(16, 0, 8));
    assert(!NeedsVertexPulling(16, 8, 8));
    assert(!NeedsVertexPulling(0, 32, 8));
    assert(!NeedsVertexPulling(0, 0, 0));
    assert(NeedsVertexPulling(8, 32, 8));
    assert(NeedsVertexPulling(8, 4, 8));
    assert(NeedsVertexPulling(6, 0, 4));
    assert(NeedsVertexPulling(16, 2, 4));
    assert(NeedsVertexPulling(16, 1, 2));
    assert(!NeedsVertexPulling(16, 2, 2));
    assert(!NeedsVertexPulling(16, 1, 1));
    assert(NeedsVertexPulling(8, 0xfffffffcu, 8));
    std::cout << "vertex layout: 12 cases passed\n";
}
