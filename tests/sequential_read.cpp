// SPDX-License-Identifier: GPL-3.0-or-later
#include <array>
#include <cassert>
#include <cstdio>
#include <limits>
#include "common/fs/sequential_read.h"

int main() {
    struct File {
        std::FILE* stream = std::tmpfile();
        unsigned seeks = 0;
        bool fail_seek = false;
        bool Seek(std::int64_t offset) {
            ++seeks;
            return !fail_seek && std::fseek(stream, offset, SEEK_SET) == 0;
        }
        std::size_t ReadSpan(std::span<std::uint8_t> data) {
            return std::fread(data.data(), 1, data.size(), stream);
        }
        ~File() { std::fclose(stream); }
    } file;
    assert(file.stream);
    const std::array<std::uint8_t, 8> source{0, 1, 2, 3, 4, 5, 6, 7};
    assert(std::fwrite(source.data(), 1, source.size(), file.stream) == source.size());
    Common::FS::SequentialRead reader;
    std::array<std::uint8_t, 2> data;
    assert(reader.Read(file, data, 0) == 2 && data[0] == 0 && data[1] == 1);
    assert(reader.Read(file, data, 2) == 2 && data[0] == 2 && data[1] == 3);
    assert(reader.Read(file, data, 4) == 2 && data[0] == 4 && data[1] == 5);
    assert(file.seeks == 1);
    assert(reader.Read(file, data, 1) == 2 && data[0] == 1 && data[1] == 2);
    assert(file.seeks == 2);
    assert(reader.Read(file, data, 7) == 1 && data[0] == 7);
    assert(reader.Read(file, data, 8) == 0);
    const auto before_retry = file.seeks;
    assert(reader.Read(file, data, 8) == 0 && file.seeks == before_retry + 1);
    reader.Reset();
    assert(file.Seek(0));
    const std::uint8_t replacement = 42;
    assert(std::fwrite(&replacement, 1, 1, file.stream) == 1);
    assert(reader.Read(file, data, 0) == 2 && data[0] == replacement);
    std::fclose(file.stream);
    file.stream = std::tmpfile();
    assert(file.stream);
    assert(std::fwrite(source.data(), 1, source.size(), file.stream) == source.size());
    reader.Reset();
    assert(reader.Read(file, data, 2) == 2 && data[0] == 2);
    file.fail_seek = true;
    assert(reader.Read(file, data, 0) == 0);
    file.fail_seek = false;
    assert(reader.Read(file, data, 4) == 2 && data[0] == 4);
    const auto before_empty = file.seeks;
    assert(reader.Read(file, std::span<std::uint8_t>{}, 6) == 0);
    assert(file.seeks == before_empty);
    assert(reader.Read(file, data, std::numeric_limits<std::size_t>::max()) == 0);
    assert(reader.Read(file, data, 6) == 2 && data[1] == 7);
    std::puts("sequential read: contiguous, random, partial/EOF, reset/write/reopen, seek failure, empty and overflow cases passed");
}
