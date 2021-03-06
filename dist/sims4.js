define("io", ["require", "exports", "utf8"], function (require, exports, utf8) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Uint64 {
        constructor(hi, lo) {
            this.hi = hi;
            this.lo = lo;
        }
        eq(num) {
            return this.hi === num.hi && this.lo === num.lo;
        }
        toString() {
            if (this.hi === 0) {
                return this.lo.toString(16);
            }
            var loString = padString(this.lo.toString(16), 8, '0');
            var hiString = this.hi.toString(16);
            return hiString + loString;
        }
    }
    exports.Uint64 = Uint64;
    function _shuffle(num, size) {
        if (size % 8 != 0) {
            throw new TypeError("Size must be 8's multiples");
        }
        if (size == 8) {
            return num;
        }
        else if (size == 16) {
            return ((num & 0xFF) << 8) | ((num >> 8) & 0xFF);
        }
        else if (size == 32) {
            return ((num & 0x000000FF) << 24) | ((num & 0x0000FF00) << 8)
                | ((num & 0x00FF0000) >> 8) | ((num >> 24) & 0xFF);
        }
        else if (size == 64) {
            var x = num;
            x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
            x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
            x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
            return x;
        }
        else {
            throw new TypeError("Unsupported endianess size");
        }
    }
    class BinaryReader {
        constructor(data, littleEndian = true) {
            this._buffer = data;
            this._pos = 0;
            this.littleEndian = littleEndian;
        }
        readInt8() { return this._decodeInt(8, true); }
        readUInt8() { return this._decodeInt(8, false); }
        readInt16() { return this._decodeInt(16, true); }
        readUInt16() { return this._decodeInt(16, false); }
        readInt32() { return this._decodeInt(32, true); }
        readUInt32() { return this._decodeInt(32, false); }
        readUInt64() {
            return this._decodeBigNumber();
        }
        readFloat() { return this._decodeFloat(23, 8); }
        readDouble() { return this._decodeFloat(52, 11); }
        readBytes(size) {
            if (size === 0) {
                return new Uint8Array(0);
            }
            this._checkSize(size * 8);
            var bytearray = this._buffer instanceof Uint8Array ? this._buffer.subarray(this._pos, this._pos + size) : this._buffer.slice(this._pos, this._pos + size);
            this._pos += size;
            var rawArray = bytearray instanceof Uint8Array ? bytearray : convertToUint8Array(bytearray);
            return rawArray;
        }
        readChar() { return this.readString(1); }
        readString(length) {
            var bytes = this.readBytes(length);
            var str = "";
            for (var i = 0; i < length; i++) {
                str += String.fromCharCode(bytes[i]);
            }
            var result = utf8.decode(str);
            return result;
        }
        read7BitLength() {
            var length = 0;
            var i = 0;
            while (true) {
                var byte = this.readUInt8();
                var num = byte & 0x7F;
                if (byte & 0x80) {
                    length += num << i;
                    i += 7;
                }
                else {
                    length += num << i;
                    break;
                }
            }
            return length;
        }
        read7bitString() {
            var length = this.read7BitLength();
            var bytes = this.readBytes(length);
            var str = "";
            for (var i = 0; i < bytes.length;) {
                str += String.fromCharCode(bytes[i++] * 256 + bytes[i++]);
            }
            return str;
        }
        seek(pos) {
            this._pos = pos;
            this._checkSize(0);
        }
        position() {
            return this._pos;
        }
        size() {
            return this._buffer instanceof Uint8Array ? this._buffer.length : this._buffer.size;
        }
        _decodeFloat(precisionBits, exponentBits) {
            var length = precisionBits + exponentBits + 1;
            var size = length >> 3;
            this._checkSize(length);
            var bias = Math.pow(2, exponentBits - 1) - 1;
            var signal = this._readBits(precisionBits + exponentBits, 1, size);
            var exponent = this._readBits(precisionBits, exponentBits, size);
            var significand = 0;
            var divisor = 2;
            var curByte = 0;
            do {
                var byteValue = this._readByte(++curByte, size);
                var startBit = precisionBits % 8 || 8;
                var mask = 1 << startBit;
                while (mask >>= 1) {
                    if (byteValue & mask) {
                        significand += 1 / divisor;
                    }
                    divisor *= 2;
                }
            } while (precisionBits -= startBit);
            this._pos += size;
            return exponent == (bias << 1) + 1 ? significand ? NaN : signal ? -Infinity : +Infinity
                : (1 + signal * -2) * (exponent || significand ? !exponent ? Math.pow(2, -bias + 1) * significand
                    : Math.pow(2, exponent - bias) * (1 + significand) : 0);
        }
        _readByte(i, size) {
            return this._buffer[this._pos + size - i - 1] & 0xff;
        }
        _decodeBigNumber() {
            var small;
            var big;
            const bits = 64;
            if (this.littleEndian) {
                small = this.readUInt32();
                big = this.readUInt32();
            }
            else {
                big = this.readUInt32();
                small = this.readUInt32();
            }
            return new Uint64(big, small);
        }
        _decodeInt(bits, signed) {
            var x = this._readBits(0, bits, bits / 8), max = Math.pow(2, bits);
            if (!this.littleEndian) {
                x = _shuffle(x, bits);
            }
            var result = signed && x >= max / 2 ? x - max : x;
            this._pos += bits / 8;
            return result;
        }
        _shl(a, b) {
            for (++b; --b; a = ((a %= 0x7fffffff + 1) & 0x40000000) == 0x40000000 ? a * 2 : (a - 0x40000000) * 2 + 0x7fffffff + 1)
                ;
            return a;
        }
        _readBits(start, length, size) {
            var offsetLeft = (start + length) % 8;
            var offsetRight = start % 8;
            var curByte = size - (start >> 3) - 1;
            var lastByte = size + (-(start + length) >> 3);
            var diff = curByte - lastByte;
            var sum = (this._readByte(curByte, size) >> offsetRight) & ((1 << (diff ? 8 - offsetRight : length)) - 1);
            if (diff && offsetLeft) {
                sum += (this._readByte(lastByte++, size) & ((1 << offsetLeft) - 1)) << (diff-- << 3) - offsetRight;
            }
            while (diff) {
                sum += this._shl(this._readByte(lastByte++, size), (diff-- << 3) - offsetRight);
            }
            return sum;
        }
        _checkSize(neededBits) {
            if (!(this._pos + Math.ceil(neededBits / 8) <= this.size())) {
                throw new Error("Index out of bound. Needs " + neededBits + " left: " + (this.size() - this._pos + Math.ceil(neededBits / 8)) + " pos: " + this._pos + " buf_length: " + this.size());
            }
        }
    }
    exports.BinaryReader = BinaryReader;
    function convertToUint8Array(blob) {
        var result = blob instanceof Uint8Array ? blob : new Uint8Array(blob.size);
        if (blob instanceof Uint8Array) {
            return blob;
        }
        for (var i = 0; i < result.length; i++) {
            result[i] = blob[i];
        }
        return result;
    }
    exports.convertToUint8Array = convertToUint8Array;
    function padString(n, width, z) {
        z = z || '0';
        n = n + '';
        return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
    }
    exports.padString = padString;
    class BinaryWriter {
        constructor(size = 65536, littleEndian = true) {
            this._buffer = new Uint8Array(size);
            this._pos = 0;
            this._length = 0;
            this.littleEndian = littleEndian;
        }
        length() {
            return this._length;
        }
        seek(pos) {
            if (pos >= this._length) {
                throw new RangeError("Buffer outside of range");
            }
            this._pos = pos;
        }
        position() {
            return this._pos;
        }
        getBuffer() {
            return this._buffer.slice(0, this._length);
        }
        writeInt8(num) { this._encodeInt(num, 8, true); }
        writeUInt8(num) { this._encodeInt(num, 8, false); }
        writeInt16(num) { this._encodeInt(num, 16, true); }
        writeUInt16(num) { this._encodeInt(num, 16, false); }
        writeInt32(num) { this._encodeInt(num, 32, true); }
        writeUInt32(num) { this._encodeInt(num, 32, false); }
        writeUInt64(num) {
            var hi = num.hi;
            var lo = num.lo;
            if (this.littleEndian) {
                this._encodeInt(lo, 32, false);
                this._encodeInt(hi, 32, false);
            }
            else {
                this._encodeInt(hi, 32, false);
                this._encodeInt(lo, 32, false);
            }
        }
        writeBytes(bytes) {
            this._checkSize(bytes.length);
            for (var i = 0; i < bytes.length; i++) {
                this._buffer[this._pos + i] = bytes[i];
            }
            this._pos += bytes.length;
            this._length = Math.max(this._length, this._pos);
        }
        writeByte(byte) {
            var data = byte & 0xFF;
            var array = new Uint8Array(1);
            array[0] = data;
            this.writeBytes(array);
        }
        writeString(str) {
            var byteString = utf8.encode(str);
            var bytes = new Uint8Array(byteString.length);
            for (var i = 0; i < bytes.length; i++) {
                bytes[i] = byteString.charCodeAt(i);
            }
            this.writeBytes(bytes);
        }
        _encodeInt(num, size, signed) {
            if (size % 8 !== 0) {
                throw new TypeError("Invalid number size");
            }
            if (!this.littleEndian) {
                num = _shuffle(num, size);
            }
            if (signed && num < 0) {
                var max = 0xFFFFFFFF >> (32 - size);
                num = max + num + 1;
            }
            var numBytes = Math.floor(size / 8);
            var array = new Uint8Array(numBytes);
            for (var i = 0; i < numBytes; i++) {
                var shiftAmount = 8 * i;
                var byte = (num >> shiftAmount) & 0xFF;
                array[i] = byte;
            }
            this.writeBytes(array);
        }
        _checkSize(size) {
            if (size + this._pos >= this._buffer.length) {
                this._expand();
            }
        }
        _expand() {
            var empty = new Uint8Array(this._buffer.length);
            this._buffer = this._arrayCopy(this._buffer, empty);
        }
        _arrayCopy(src1, src2, dest) {
            if (!dest) {
                dest = new Uint8Array(src1.length + src2.length);
            }
            for (var i = 0; i < src1.length; i++) {
                dest[i] = src1[i];
            }
            for (var i = 0; i < src2.length; i++) {
                dest[i + src1.length] = src2[i];
            }
            return dest;
        }
    }
    exports.BinaryWriter = BinaryWriter;
    class BitConverter {
        static _readNumber(data, offset, size, signed) {
            var br = new BinaryReader(data);
            br.seek(offset);
            if (size == 8) {
                return signed ? br.readInt8() : br.readUInt8();
            }
            else if (size == 16) {
                return signed ? br.readInt16() : br.readUInt16();
            }
            else if (size == 32) {
                return signed ? br.readInt32() : br.readUInt32();
            }
            else {
                throw new Error("Not implemented");
            }
        }
        static toUInt16(data, offset) {
            return BitConverter._readNumber(data, offset, 16, false);
        }
        static toInt16(data, offset) {
            return BitConverter._readNumber(data, offset, 16, true);
        }
        static toUInt32(data, offset) {
            return BitConverter._readNumber(data, offset, 32, false);
        }
        static toInt32(data, offset) {
            return BitConverter._readNumber(data, offset, 32, true);
        }
    }
    exports.BitConverter = BitConverter;
});
define("package", ["require", "exports", "io", "pako"], function (require, exports, IO, pako) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Package {
        constructor(file) {
            this.HEADER_SIZE = 96;
            this.FOURCC = "DBPF";
            this.ZLIB = 0x5A42;
            this._file = file;
            var header_blob = this.slice(0, this.HEADER_SIZE);
            var entryCount = this.readHeader(header_blob);
            this.ResourceEntryList = new Array(entryCount);
            var entryData = this.slice(this.IndexPosition);
            var r = new IO.BinaryReader(entryData);
            var indexType = r.readInt32();
            var hdr = new Int32Array(this.hdrsize(indexType));
            var entry = new Int32Array(9 - hdr.length);
            hdr[0] = indexType;
            for (var i = 1; i < hdr.length; i++) {
                hdr[i] = r.readInt32();
            }
            for (var i = 0; i < entryCount; i++) {
                for (var j = 0; j < entry.length; j++) {
                    entry[j] = r.readInt32();
                }
                this.ResourceEntryList[i] = new TGIResourceBlock(hdr, entry);
            }
        }
        hdrsize(indextype) {
            var hc = 1;
            for (var i = 0; i < 4; i++)
                if ((indextype & (1 << i)) != 0)
                    hc++;
            return hc;
        }
        slice(pos, size) {
            if (this._file instanceof Uint8Array) {
                return size ? this._file.subarray(pos, pos + size) : this._file.subarray(pos);
            }
            else {
                return size ? this._file.slice(pos, pos + size) : this._file.slice(pos);
            }
        }
        getResourceEntry(tgi) {
            var result = this.ResourceEntryList.find((entry) => {
                return entry.ResourceType == tgi.ResourceType && entry.ResourceType == tgi.ResourceType && entry.ResourceInstance.eq(tgi.ResourceInstance);
            });
            return result;
        }
        getResourceStream(tgi) {
            var block = this.getResourceEntry(tgi);
            if (block) {
                var rawData = this.slice(block.ChunkOffset, block.ChunkOffset + block.FileSize);
                if (block.Compressed == this.ZLIB) {
                    if (rawData[0] != 0x78 && rawData[1] != 0x9C) {
                        throw new TypeError("Invalid Zlib data");
                    }
                    var dataArray = IO.convertToUint8Array(rawData);
                    var result = pako.inflate(dataArray);
                    if (result.length != block.Memsize) {
                        throw new TypeError("Invalid Zlib data");
                    }
                    return result;
                }
                else {
                    return rawData;
                }
            }
            else {
                return undefined;
            }
        }
        readHeader(data) {
            var data_size = (data instanceof Uint8Array) ? data.length : data.size;
            if (data_size != this.HEADER_SIZE) {
                throw new TypeError("Wrong header size. Get " + data_size + " expected " + this.HEADER_SIZE);
            }
            var r = new IO.BinaryReader(data);
            var fourcc = r.readString(4);
            if (fourcc !== this.FOURCC) {
                throw new TypeError("Incorrect package format");
            }
            this.Major = r.readInt32();
            this.Minor = r.readInt32();
            this.Unknown1 = r.readBytes(24);
            var entryCount = r.readInt32();
            this.Unknown2 = r.readUInt32();
            this.IndexSize = r.readInt32();
            this.Unknown3 = r.readBytes(12);
            this.IndexVersion = r.readInt32();
            this.IndexPosition = r.readInt32();
            this.Unknown4 = r.readBytes(28);
            return entryCount;
        }
    }
    exports.Package = Package;
    class TGIResourceBlock {
        constructor(header, entry) {
            var dataInt = new Uint32Array(header.length + entry.length - 1);
            var type = header[0];
            var countEntry = 0;
            for (var i = 0; i < 8; i++) {
                dataInt[i] = ((type >> i) | 1) != (type >> i) ? dataInt[i] = entry[countEntry++] : dataInt[i] = header[i - countEntry + 1];
            }
            this.ResourceType = dataInt[0];
            this.ResourceGroup = dataInt[1];
            var instanceHi = dataInt[2];
            var instanceLo = dataInt[3];
            this.ResourceInstance = new IO.Uint64(instanceHi, instanceLo);
            this.ChunkOffset = dataInt[4];
            var fileSize = dataInt[5];
            this.Unknown1 = (fileSize >> 31) & 1;
            this.FileSize = (fileSize << 1) >> 1;
            this.Memsize = dataInt[6];
            var meta = dataInt[7];
            this.Compressed = meta & 0xFFFF;
            this.Committed = (meta >> 16) & 0xFFFF;
        }
    }
    exports.TGIResourceBlock = TGIResourceBlock;
    class TGIBlock {
        constructor(type, group, instance) {
            this.ResourceType = type;
            this.ResourceGroup = group;
            this.ResourceInstance = instance;
        }
        eq(tgi) {
            return this.ResourceType == tgi.ResourceType && this.ResourceGroup == tgi.ResourceGroup && this.ResourceInstance.eq(tgi.ResourceInstance);
        }
    }
    exports.TGIBlock = TGIBlock;
    class ResourceWrapper {
        constructor(data) {
            this.parse(data);
        }
        parse(data) {
            this._rawData = data;
        }
        unparse() {
            return this._rawData;
        }
    }
    ResourceWrapper.ResourceType = ['*'];
    exports.ResourceWrapper = ResourceWrapper;
});
define("cas", ["require", "exports", "package", "io"], function (require, exports, Package, IO) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class CASPWrapper extends Package.ResourceWrapper {
        parse(data) {
            var br = new IO.BinaryReader(data);
            this.version = br.readUInt32();
            var dataSize = br.readUInt32();
            var tgiPos = br.position() + dataSize;
            this.presetCount = br.readUInt32();
            this.name = br.read7bitString();
            this.sortPriority = br.readFloat();
            br.readUInt16();
            this.propertyID = br.readUInt32();
            br.readUInt32();
            var paramFlags = br.readUInt8();
            if (this.version >= 39) {
                br.readUInt8();
            }
            br.readUInt64();
            if (this.version >= 41) {
                br.readUInt64();
            }
            if (this.version >= 36) {
                br.readUInt64();
            }
            else {
                br.readUInt32();
            }
            var tagCount = br.readUInt32();
            if (this.version >= 37) {
                br.readBytes(tagCount * 6);
            }
            else {
                br.readBytes(tagCount * 4);
            }
            var deprecatedPrice = br.readUInt32();
            br.readUInt32();
            br.readUInt32();
            br.readUInt8();
            br.readUInt32();
            br.readUInt32();
            var ageGender = br.readUInt32();
            if (this.version >= 0x20) {
                br.readUInt32();
            }
            if (this.version >= 34) {
                br.readInt16();
                br.readUInt8();
                br.readBytes(9);
            }
            else {
                var unused2 = br.readUInt8();
                if (unused2 > 0) {
                    br.readUInt8();
                }
            }
            var colorCount = br.readUInt8();
            this.colorList = new Uint32Array(colorCount);
            for (var i = 0; i < colorCount; i++) {
                this.colorList[i] = br.readUInt32();
            }
            br.readUInt8();
            br.readUInt8();
            if (this.version >= 0x1C) {
                br.readUInt64();
            }
            if (this.version >= 0x1E) {
                var usedMaterialCount = br.readUInt8();
                if (usedMaterialCount > 0) {
                    br.readUInt32();
                    br.readUInt32();
                    br.readUInt32();
                }
            }
            if (this.version >= 0x1F) {
                br.readUInt32();
            }
            if (this.version >= 38) {
                br.readUInt64();
            }
            if (this.version >= 39) {
                br.readUInt64();
            }
            br.readUInt8();
            br.readUInt8();
            br.readUInt32();
            var numLOD = br.readUInt8();
            this.lodList = new Array(numLOD);
            for (var i = 0; i < numLOD; i++) {
                this.lodList[i] = new LOD(br);
            }
            var numSlot = br.readUInt8();
            br.readBytes(numSlot);
            this.diffuseKey = br.readUInt8();
            this.shadowKey = br.readUInt8();
            br.readUInt8();
            br.readUInt8();
            var numOverride = br.readUInt8();
            br.readBytes(5 * numOverride);
            this.normalMapKey = br.readUInt8();
            this.specularMapKey = br.readUInt8();
            if (this.version >= 0x1B) {
                br.readUInt32();
            }
            if (this.version >= 0x1E) {
                br.readUInt8();
            }
            if (this.version >= 42) {
                br.readUInt8();
            }
            if (br.position() != tgiPos) {
                throw new TypeError("Invalid CASP format. \ Version: " + this.version + " \
      TGI position at " + tgiPos + " now at " + br.position());
            }
            var numTGI = br.readUInt8();
            this.tgiList = new Array(numTGI);
            for (var i = 0; i < numTGI; i++) {
                var instance = br.readUInt64();
                var group = br.readUInt32();
                var type = br.readUInt32();
                this.tgiList[i] = new Package.TGIBlock(type, group, instance);
            }
        }
    }
    CASPWrapper.ResourceType = ["0x034AEECB"];
    exports.CASPWrapper = CASPWrapper;
    class LOD {
        constructor(br) {
            this.level = br.readUInt8();
            this.unused = br.readUInt32();
            var numAssets = br.readUInt8();
            this.assets = new Uint32Array(3 * numAssets);
            for (var i = 0; i < numAssets; i++) {
                this.assets[i * 3] = br.readUInt32();
                this.assets[i * 3 + 1] = br.readUInt32();
                this.assets[i * 3 + 2] = br.readUInt32();
            }
            var numLOD = br.readUInt8();
            this.lodKey = new Uint8Array(numLOD);
            for (var i = 0; i < numLOD; i++) {
                this.lodKey[i] = br.readUInt8();
            }
        }
    }
    exports.LOD = LOD;
});
define("rcol", ["require", "exports", "io", "package"], function (require, exports, IO, Package) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class RCOLChunk {
        constructor(data) {
            this._data = data;
            this.parse(data);
        }
        parse(data) {
        }
    }
    exports.RCOLChunk = RCOLChunk;
    class VertexFormat {
        constructor(data) {
            var br = data instanceof IO.BinaryReader ? data : new IO.BinaryReader(data);
            this.dataType = br.readUInt32();
            this.subType = br.readUInt32();
            this.bytesPerElement = br.readUInt8();
        }
    }
    exports.VertexFormat = VertexFormat;
    var VertexDataType;
    (function (VertexDataType) {
        VertexDataType[VertexDataType["Unknown1"] = 0] = "Unknown1";
        VertexDataType[VertexDataType["Position"] = 1] = "Position";
        VertexDataType[VertexDataType["Normal"] = 2] = "Normal";
        VertexDataType[VertexDataType["UV"] = 3] = "UV";
        VertexDataType[VertexDataType["BoneAssignment"] = 4] = "BoneAssignment";
        VertexDataType[VertexDataType["Unknown2"] = 4] = "Unknown2";
        VertexDataType[VertexDataType["TangentNormal"] = 6] = "TangentNormal";
        VertexDataType[VertexDataType["Color"] = 7] = "Color";
        VertexDataType[VertexDataType["Unknown3"] = 8] = "Unknown3";
        VertexDataType[VertexDataType["Unknown4"] = 9] = "Unknown4";
        VertexDataType[VertexDataType["VertexID"] = 10] = "VertexID";
    })(VertexDataType = exports.VertexDataType || (exports.VertexDataType = {}));
    class Vertex {
        constructor(type, value) {
            this.type = type;
            this.value = value;
        }
        toString() {
            return "Type: " + this.type + "Value: " + this.value.toString();
        }
    }
    exports.Vertex = Vertex;
    class VertexData {
        constructor(data, vertexFormatList) {
            var br = data instanceof IO.BinaryReader ? data : new IO.BinaryReader(data);
            this.vData = new Array(vertexFormatList.length);
            for (var i = 0; i < vertexFormatList.length; i++) {
                var vf = vertexFormatList[i];
                if (vf.dataType == 1 || vf.dataType == 2 || vf.dataType == 6) {
                    this.vData[i] = new Vertex(vf.dataType, [br.readFloat(), br.readFloat(), br.readFloat()]);
                }
                else if (vf.dataType == 4 || vf.dataType == 5 || vf.dataType == 7 || vf.dataType == 10) {
                    this.vData[i] = new Vertex(vf.dataType, [br.readUInt32()]);
                }
                else if (vf.dataType == 3) {
                    this.vData[i] = new Vertex(vf.dataType, [br.readFloat(), br.readFloat()]);
                }
            }
        }
    }
    exports.VertexData = VertexData;
    class GEOMRCOLChunk extends RCOLChunk {
        parse(data) {
            var br = new IO.BinaryReader(data);
            var fourcc = br.readString(4);
            if (fourcc != GEOMRCOLChunk.FOURCC) {
                throw new TypeError("Invalild GEOM chunk");
            }
            this.version = br.readUInt32();
            var tgiOffset = br.readUInt32();
            var tgiSize = br.readUInt32();
            this.embeddedID = br.readUInt32();
            if (this.embeddedID !== 0) {
                var mtnfSize = br.readUInt32();
                br.readBytes(mtnfSize);
            }
            this.mergeGroup = br.readUInt32();
            this.sortOrder = br.readUInt32();
            var numVerts = br.readInt32();
            var fCount = br.readUInt32();
            this.vertexFormatList = new Array(fCount);
            for (var i = 0; i < fCount; i++) {
                this.vertexFormatList[i] = new VertexFormat(br);
            }
            this.vertexDataList = new Array(numVerts);
            for (var i = 0; i < numVerts; i++) {
                this.vertexDataList[i] = new VertexData(br, this.vertexFormatList);
            }
            var itemCount = br.readUInt32();
            if (itemCount != 1) {
                throw new TypeError("Invalid GEOM. Get itemCount: " + itemCount + " expect 1");
            }
            var bytesPerFacePoint = br.readUInt8();
            if (bytesPerFacePoint != 2) {
                throw new TypeError("Invalid GEOM. Get itemCount: " + bytesPerFacePoint + " expect 2");
            }
            var faceCount = br.readUInt32();
            this.facePointList = new Uint16Array(faceCount);
            for (var i = 0; i < faceCount; i++) {
                this.facePointList[i] = br.readUInt16();
            }
        }
        getThreeJsJSONData() {
            var vertexData = this._getVertexData();
            var vertices = vertexData.pos;
            var faces = this._getFaceData(vertexData);
            var json_data = {
                "metadata": { "formatVersion": 3 },
                "materials": [],
                "vertices": vertices,
                "morphTargets": [],
                "normals": vertexData.normal,
                "colors": [],
                "uvs": [vertexData.uv],
                "faces": faces
            };
            return json_data;
        }
        _getVertexData() {
            var numVertex = this.vertexDataList.length;
            var result = {
                "pos": new Float32Array(numVertex * 3),
                "uv": new Float32Array(numVertex * 2),
                "normal": new Float32Array(numVertex * 3)
            };
            for (var i = 0; i < numVertex; i++) {
                var v = this.vertexDataList[i];
                var posV = v.vData.find(entry => { return entry.type === VertexDataType.Position; });
                if (!posV) {
                    throw new TypeError("Malformed data");
                }
                var uvV = v.vData.find(entry => { return entry.type === VertexDataType.UV; });
                if (!uvV) {
                    throw new TypeError("Malformed data");
                }
                var normalV = v.vData.find(entry => { return entry.type === VertexDataType.Normal; });
                if (!normalV) {
                    throw new TypeError("Malformed data");
                }
                result.pos[i * 3] = posV.value[0];
                result.pos[i * 3 + 1] = posV.value[1];
                result.pos[i * 3 + 2] = posV.value[2];
                result.uv[i * 2] = uvV.value[0];
                result.uv[i * 2 + 1] = uvV.value[1];
                result.normal[i * 3] = normalV.value[0];
                result.normal[i * 3 + 1] = normalV.value[1];
                result.normal[i * 3 + 2] = normalV.value[2];
            }
            return result;
        }
        _getFaceData(vertexData) {
            var hasUV = false;
            var hasNormal = false;
            var flag = 0;
            var size = 3 + 1;
            if (vertexData.uv.length > 0) {
                hasUV = true;
                flag = flag | (1 << 3);
                size += 3;
            }
            if (vertexData.normal.length > 0) {
                hasNormal = true;
                flag = flag | (1 << 5);
                size += 3;
            }
            var result = new Uint32Array(this.facePointList.length / 3 * size);
            var counter = 0;
            var faceCounter = 0;
            while (counter < result.length) {
                if (counter % size == 0) {
                    result[counter++] = flag;
                }
                var face0 = this.facePointList[faceCounter++];
                var face1 = this.facePointList[faceCounter++];
                var face2 = this.facePointList[faceCounter++];
                result[counter++] = face0;
                result[counter++] = face1;
                result[counter++] = face2;
                if (hasUV) {
                    result[counter++] = face0;
                    result[counter++] = face1;
                    result[counter++] = face2;
                }
                if (hasNormal) {
                    result[counter++] = face0;
                    result[counter++] = face1;
                    result[counter++] = face2;
                }
            }
            return result;
        }
    }
    GEOMRCOLChunk.FOURCC = "GEOM";
    exports.GEOMRCOLChunk = GEOMRCOLChunk;
    class RCOLWrapper extends Package.ResourceWrapper {
        parse(data) {
            var br = new IO.BinaryReader(data);
            this.version = br.readUInt32();
            var internalChunkCount = br.readUInt32();
            this.index3 = br.readUInt32();
            var externalCount = br.readUInt32();
            var internalCount = br.readUInt32();
            this.internalTGIList = new Array(internalCount);
            for (var i = 0; i < internalCount; i++) {
                var instance = br.readUInt64();
                var type = br.readUInt32();
                var group = br.readUInt32();
                this.internalTGIList[i] = new Package.TGIBlock(type, group, instance);
            }
            this.externalTGIList = new Array(externalCount);
            for (var i = 0; i < externalCount; i++) {
                var instance = br.readUInt64();
                var type = br.readUInt32();
                var group = br.readUInt32();
                this.externalTGIList[i] = new Package.TGIBlock(type, group, instance);
            }
            this.rcolChunkList = new Array(internalCount);
            for (var i = 0; i < internalCount; i++) {
                var position = br.readUInt32();
                var size = br.readUInt32();
                var chunkData = data.slice(position, position + size);
                this.rcolChunkList[i] = getRCOLChunk(chunkData);
            }
        }
    }
    exports.RCOLWrapper = RCOLWrapper;
    const RCOLRegister = {
        "*": RCOLChunk,
        "GEOM": GEOMRCOLChunk
    };
    function getRCOLChunk(data) {
        var br = new IO.BinaryReader(data);
        var type = br.readString(4);
        var chunk = RCOLRegister[type];
        if (chunk) {
            var result = new chunk(data);
            return result;
        }
        else {
            return new RCOLChunk(data);
        }
    }
    exports.getRCOLChunk = getRCOLChunk;
});
define("helper", ["require", "exports", "package", "cas", "rcol"], function (require, exports, Package, CAS, RCOL) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function find_geom(data) {
        var pack = new Package.Package(data);
        var casp = pack.ResourceEntryList.find(entry => entry.ResourceType == 0x034AEECB);
        if (!casp) {
            return undefined;
        }
        var w = new CAS.CASPWrapper(pack.getResourceStream(casp));
        var lods = w.lodList;
        var geomList = Array(lods.length);
        for (var i = 0; i < geomList.length; i++) {
            var lod = lods[i];
            geomList[lod.level] = new Array(lod.lodKey.length);
            for (var j = 0; j < lod.lodKey.length; j++) {
                var tgiIndex = lod.lodKey[j];
                if (tgiIndex >= w.tgiList.length) {
                    throw Error("Cannot find TGI index " + tgiIndex);
                }
                var tgi = w.tgiList[tgiIndex];
                if (tgi.ResourceType !== 0x015A1849) {
                    throw Error("Corrupted CASP file");
                }
                var geomStream = pack.getResourceStream(tgi);
                if (!geomStream) {
                    throw new Error("Unable to find required GEOM inside the package file");
                }
                var rcol = new RCOL.RCOLWrapper(geomStream);
                var geom = rcol.rcolChunkList[0];
                geomList[lod.level][j] = geom;
            }
        }
        return geomList;
    }
    exports.find_geom = find_geom;
});
define("img", ["require", "exports", "io", "package"], function (require, exports, IO, Package) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var RLEVersion;
    (function (RLEVersion) {
        RLEVersion[RLEVersion["RLE2"] = 843402322] = "RLE2";
        RLEVersion[RLEVersion["RLES"] = 1397050450] = "RLES";
    })(RLEVersion = exports.RLEVersion || (exports.RLEVersion = {}));
    var FourCC;
    (function (FourCC) {
        FourCC[FourCC["DST1"] = 827609924] = "DST1";
        FourCC[FourCC["DST3"] = 861164356] = "DST3";
        FourCC[FourCC["DST5"] = 894718788] = "DST5";
        FourCC[FourCC["DXT1"] = 827611204] = "DXT1";
        FourCC[FourCC["DXT3"] = 861165636] = "DXT3";
        FourCC[FourCC["DXT5"] = 894720068] = "DXT5";
        FourCC[FourCC["ATI1"] = 826889281] = "ATI1";
        FourCC[FourCC["ATI2"] = 843666497] = "ATI2";
        FourCC[FourCC["None"] = 0] = "None";
    })(FourCC = exports.FourCC || (exports.FourCC = {}));
    var HeaderFlags;
    (function (HeaderFlags) {
        HeaderFlags[HeaderFlags["Texture"] = 4103] = "Texture";
        HeaderFlags[HeaderFlags["Mipmap"] = 131072] = "Mipmap";
        HeaderFlags[HeaderFlags["Volume"] = 8388608] = "Volume";
        HeaderFlags[HeaderFlags["Pitch"] = 8] = "Pitch";
        HeaderFlags[HeaderFlags["LinearSize"] = 524288] = "LinearSize";
    })(HeaderFlags = exports.HeaderFlags || (exports.HeaderFlags = {}));
    var PixelFormatFlags;
    (function (PixelFormatFlags) {
        PixelFormatFlags[PixelFormatFlags["FourCC"] = 4] = "FourCC";
        PixelFormatFlags[PixelFormatFlags["RGB"] = 64] = "RGB";
        PixelFormatFlags[PixelFormatFlags["RGBA"] = 65] = "RGBA";
        PixelFormatFlags[PixelFormatFlags["Luminance"] = 131072] = "Luminance";
    })(PixelFormatFlags = exports.PixelFormatFlags || (exports.PixelFormatFlags = {}));
    var DDSCaps;
    (function (DDSCaps) {
        DDSCaps[DDSCaps["DDSCaps_Complex"] = 8] = "DDSCaps_Complex";
        DDSCaps[DDSCaps["DDSCaps_Mipmap"] = 4194304] = "DDSCaps_Mipmap";
        DDSCaps[DDSCaps["DDSCaps_Texture"] = 4096] = "DDSCaps_Texture";
    })(DDSCaps || (DDSCaps = {}));
    class PixelFormat {
        constructor(data) {
            this.size = 32;
            this.fourcc = FourCC.DXT5;
            if (data) {
                var br = data instanceof IO.BinaryReader ? data : new IO.BinaryReader(data);
                var size = br.readUInt32();
                if (size != this.size) {
                    throw new TypeError("Invalid format");
                }
                this.pixelFormatFlag = br.readUInt32();
                this.fourcc = br.readUInt32();
                this.RGBBitCount = br.readUInt32();
                this.redBitMask = br.readUInt32();
                this.greenBitMask = br.readUInt32();
                this.blueBitMask = br.readUInt32();
                this.alphaBitMask = br.readUInt32();
            }
            else {
                this.RGBBitCount = 32;
                this.redBitMask = 0x00FF0000;
                this.greenBitMask = 0x0000FF00;
                this.blueBitMask = 0x000000FF;
                this.alphaBitMask = 0xFF000000;
            }
        }
        ;
        unParse(w) {
            w.writeUInt32(this.size);
            w.writeUInt32(this.pixelFormatFlag);
            w.writeUInt32(this.fourcc);
            w.writeUInt32(this.RGBBitCount);
            w.writeUInt32(this.redBitMask);
            w.writeUInt32(this.greenBitMask);
            w.writeUInt32(this.blueBitMask);
            w.writeUInt32(this.alphaBitMask);
        }
    }
    PixelFormat.StructureSize = 32;
    exports.PixelFormat = PixelFormat;
    class RLEInfo {
        constructor(data) {
            this.Depth = 1;
            this.Reserved1 = new Uint8Array(11 * 4);
            this.reserved2 = new Uint8Array(3 * 4);
            var br = data instanceof IO.BinaryReader ? data : new IO.BinaryReader(data);
            br.seek(0);
            var fourcc = br.readUInt32();
            this.Version = br.readUInt32();
            this.Width = br.readUInt16();
            this.Height = br.readUInt16();
            this.mipCount = br.readUInt16();
            this.Unknown0E = br.readUInt16();
            this.headerFlags = HeaderFlags.Texture;
            if (this.Unknown0E !== 0) {
                throw new TypeError("Invalid data at position " + br.position());
            }
            this.pixelFormat = new PixelFormat();
        }
        size() { return (18 * 4) + PixelFormat.StructureSize + (5 * 4); }
        unParse(w) {
            w.writeUInt32(RLEInfo.Signature);
            w.writeUInt32(this.size());
            w.writeUInt32(this.mipCount > 1 ? this.headerFlags | HeaderFlags.Mipmap | HeaderFlags.LinearSize : this.headerFlags | HeaderFlags.LinearSize);
            w.writeUInt32(this.Height);
            w.writeUInt32(this.Width);
            var blockSize = this.pixelFormat.Fourcc == FourCC.DST1 || this.pixelFormat.Fourcc == FourCC.DXT1 || this.pixelFormat.Fourcc == FourCC.ATI1 ? 8 : 16;
            w.writeUInt32(Math.floor((Math.max(1, ((this.Width + 3) / 4)) * blockSize) * (Math.max(1, (this.Height + 3) / 4))));
            w.writeUInt32(1);
            w.writeUInt32(this.mipCount);
            w.writeBytes(this.Reserved1);
            this.pixelFormat.unParse(w);
            w.writeUInt32(this.mipCount > 1 ? DDSCaps.DDSCaps_Complex | DDSCaps.DDSCaps_Mipmap | DDSCaps.DDSCaps_Texture : DDSCaps.DDSCaps_Texture);
            w.writeUInt32(0);
            w.writeBytes(this.reserved2);
        }
    }
    RLEInfo.Signature = 0x20534444;
    exports.RLEInfo = RLEInfo;
    class MipHeader {
    }
    exports.MipHeader = MipHeader;
    class RLEWrapper extends Package.ResourceWrapper {
        parse(data) {
            var br = new IO.BinaryReader(data);
            this.info = new RLEInfo(br);
            this.MipHeaders = new Array(this.info.mipCount + 1);
            for (var i = 0; i < this.info.mipCount; i++) {
                var header = new MipHeader();
                header.CommandOffset = br.readInt32();
                header.Offset2 = br.readInt32();
                header.Offset3 = br.readInt32();
                header.Offset0 = br.readInt32();
                header.Offset1 = br.readInt32();
                this.MipHeaders[i] = header;
            }
            var header = new MipHeader();
            header.CommandOffset = this.MipHeaders[0].Offset2;
            header.Offset2 = this.MipHeaders[0].Offset3;
            header.Offset3 = this.MipHeaders[0].Offset0;
            header.Offset0 = this.MipHeaders[0].Offset1;
            this.MipHeaders[this.info.mipCount] = header;
            if (this.info.Version == RLEVersion.RLES) {
                this.MipHeaders[this.info.mipCount].Offset1 = this.MipHeaders[0].Offset4;
                this.MipHeaders[this.info.mipCount].Offset4 = br.size();
            }
            else {
                this.MipHeaders[this.info.mipCount].Offset1 = br.size();
            }
            this._data = data;
        }
        UncompressDXT5(data) {
            var imageData = new ImageData(this.info.Width, this.info.Height);
            var r = new IO.BinaryReader(data);
            for (var j = 0; j < this.info.Height; j += 4) {
                for (var i = 0; i < this.info.Width; i += 4) {
                    this.DecompressBlockDXT5(i, j, r.readBytes(16), imageData);
                }
            }
            return imageData;
        }
        DecompressBlockDXT5(x, y, blockStorage, imageData) {
            var alpha0 = blockStorage[0];
            var alpha1 = blockStorage[1];
            var bitOffset = 2;
            var alphaCode1 = (blockStorage[bitOffset + 2] | (blockStorage[bitOffset + 3] << 8) | (blockStorage[bitOffset + 4] << 16) | (blockStorage[bitOffset + 5] << 24)) & 0xFFFFFFFF;
            var alphaCode2 = (blockStorage[bitOffset + 0] | (blockStorage[bitOffset + 1] << 8)) & 0xFFFF;
            var color0 = (blockStorage[8] | blockStorage[9] << 8) & 0xFFFF;
            var color1 = (blockStorage[10] | blockStorage[11] << 8) & 0xFFFF;
            var temp;
            temp = (color0 >> 11) * 255 + 16;
            var r0 = 0xFF & ((temp / 32 + temp) / 32);
            temp = ((color0 & 0x07E0) >> 5) * 255 + 32;
            var g0 = 0xFF & ((temp / 64 + temp) / 64);
            temp = (color0 & 0x001F) * 255 + 16;
            var b0 = 0xFF & ((temp / 32 + temp) / 32);
            temp = (color1 >> 11) * 255 + 16;
            var r1 = 0xFF & ((temp / 32 + temp) / 32);
            temp = ((color1 & 0x07E0) >> 5) * 255 + 32;
            var g1 = 0xFF & ((temp / 64 + temp) / 64);
            temp = (color1 & 0x001F) * 255 + 16;
            var b1 = 0xFF & ((temp / 32 + temp) / 32);
            var code = 0xFFFFFFFF & (blockStorage[12] | blockStorage[13] << 8 | blockStorage[14] << 16 | blockStorage[15] << 24);
            for (var j = 0; j < 4; j++) {
                for (var i = 0; i < 4; i++) {
                    var alphaCodeIndex = 3 * (4 * j + i);
                    var alphaCode;
                    if (alphaCodeIndex <= 12) {
                        alphaCode = (alphaCode2 >> alphaCodeIndex) & 0x07;
                    }
                    else if (alphaCodeIndex == 15) {
                        alphaCode = 0xFFFFFFFF & ((alphaCode2 >> 15) | ((alphaCode1 << 1) & 0x06));
                    }
                    else {
                        alphaCode = 0xFFFFFFFF & ((alphaCode1 >> (alphaCodeIndex - 16)) & 0x07);
                    }
                    var finalAlpha;
                    if (alphaCode == 0) {
                        finalAlpha = alpha0;
                    }
                    else if (alphaCode == 1) {
                        finalAlpha = alpha1;
                    }
                    else {
                        if (alpha0 > alpha1) {
                            finalAlpha = 0xFF & (((8 - alphaCode) * alpha0 + (alphaCode - 1) * alpha1) / 7);
                        }
                        else {
                            if (alphaCode == 6)
                                finalAlpha = 0;
                            else if (alphaCode == 7)
                                finalAlpha = 255;
                            else
                                finalAlpha = 0xFF & (((6 - alphaCode) * alpha0 + (alphaCode - 1) * alpha1) / 5);
                        }
                    }
                    var colorCode = 0xFF & ((code >> 2 * (4 * j + i)) & 0x03);
                    var r;
                    var g;
                    var b;
                    var a = finalAlpha;
                    switch (colorCode) {
                        case 0:
                            r = r0;
                            g = g0;
                            b = b0;
                            break;
                        case 1:
                            r = r1;
                            g = g1;
                            b = b1;
                            break;
                        case 2:
                            r = (2 * r0 + r1) / 3;
                            g = (2 * g0 + g1) / 3;
                            b = (2 * b0 + b1) / 3;
                            break;
                        case 3:
                            r = (r0 + 2 * r1) / 3;
                            g = (g0 + 2 * g1) / 3;
                            b = (b0 + 2 * b1) / 3;
                            break;
                    }
                    var width = this.info.Width;
                    var height = this.info.Height;
                    var index = (x + i + (y + j) * width) * 4;
                    var value = [r, g, b, a];
                    imageData.data.set(value, index);
                }
            }
        }
        toImageData() {
            var dds = this.toDDS();
            return this.UncompressDXT5(dds.subarray(128));
        }
        toDDS() {
            var w = new IO.BinaryWriter();
            this.info.unParse(w);
            var fullTransparentAlpha = Uint8Array.from([0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
            var fullTransparentColor = Uint8Array.from([0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
            var fullOpaqueAlpha = Uint8Array.from([0x00, 0x05, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
            if (this.info.Version != RLEVersion.RLE2) {
                throw new Error("Format other than RLE2 is not supported");
            }
            for (var i = 0; i < this.info.mipCount; i++) {
                var mipHeader = this.MipHeaders[i];
                var nextMipHeader = this.MipHeaders[i + 1];
                var blockOffset2, blockOffset3, blockOffset0, blockOffset1;
                blockOffset2 = mipHeader.Offset2;
                blockOffset3 = mipHeader.Offset3;
                blockOffset0 = mipHeader.Offset0;
                blockOffset1 = mipHeader.Offset1;
                for (var commandOffset = mipHeader.CommandOffset; commandOffset < nextMipHeader.CommandOffset; commandOffset += 2) {
                    var command = IO.BitConverter.toUInt16(this._data, commandOffset);
                    var op = command & 3;
                    var count = command >> 2;
                    if (op == 0) {
                        for (var j = 0; j < count; j++) {
                            w.writeBytes(fullTransparentAlpha.slice(0, 8));
                            w.writeBytes(fullTransparentAlpha.slice(0, 8));
                        }
                    }
                    else if (op == 1) {
                        for (var j = 0; j < count; j++) {
                            w.writeBytes(IO.convertToUint8Array(this._data.slice(blockOffset0, blockOffset0 + 2)));
                            w.writeBytes(IO.convertToUint8Array(this._data.slice(blockOffset1, blockOffset1 + 6)));
                            w.writeBytes(IO.convertToUint8Array(this._data.slice(blockOffset2, blockOffset2 + 4)));
                            w.writeBytes(IO.convertToUint8Array(this._data.slice(blockOffset3, blockOffset3 + 4)));
                            blockOffset2 += 4;
                            blockOffset3 += 4;
                            blockOffset0 += 2;
                            blockOffset1 += 6;
                        }
                    }
                    else if (op == 2) {
                        for (var j = 0; j < count; j++) {
                            w.writeBytes(fullOpaqueAlpha.slice(0, 8));
                            w.writeBytes(IO.convertToUint8Array(this._data.slice(blockOffset2, blockOffset2 + 4)));
                            w.writeBytes(IO.convertToUint8Array(this._data.slice(blockOffset3, 4)));
                            blockOffset2 += 4;
                            blockOffset3 += 4;
                        }
                    }
                    else {
                        throw new Error("Not supported");
                    }
                }
                if (blockOffset0 != nextMipHeader.Offset0 ||
                    blockOffset1 != nextMipHeader.Offset1 ||
                    blockOffset2 != nextMipHeader.Offset2 ||
                    blockOffset3 != nextMipHeader.Offset3) {
                    throw new Error("Invalid operation");
                }
            }
            return w.getBuffer();
        }
    }
    exports.RLEWrapper = RLEWrapper;
});
//# sourceMappingURL=sims4.js.map