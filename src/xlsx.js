/*
 * A very small .xlsx writer.
 *
 * Enough to turn a grid of strings and numbers into a real workbook Excel will
 * open, with no library. Entries are stored uncompressed, which needs no
 * deflate implementation and costs nothing at these sizes, and cells use
 * inline strings, which avoids a shared-string table.
 *
 * Kept free of DOM and Node APIs so the same code runs in the browser and in
 * the tests.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QuranXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var encoder = new TextEncoder();

    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function escapeXml(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
            // Excel rejects most control characters outright.
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }

    /** 0 -> A, 25 -> Z, 26 -> AA … */
    function columnName(index) {
        var name = '';
        var n = index;
        do {
            name = String.fromCharCode(65 + (n % 26)) + name;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        return name;
    }

    function sheetXml(rows) {
        var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<sheetData>';
        for (var r = 0; r < rows.length; r++) {
            out += '<row r="' + (r + 1) + '">';
            var row = rows[r] || [];
            for (var c = 0; c < row.length; c++) {
                var value = row[c];
                if (value === null || value === undefined || value === '') continue;
                var ref = columnName(c) + (r + 1);
                if (typeof value === 'number' && isFinite(value)) {
                    out += '<c r="' + ref + '"><v>' + value + '</v></c>';
                } else {
                    out += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
                        escapeXml(value) + '</t></is></c>';
                }
            }
            out += '</row>';
        }
        return out + '</sheetData></worksheet>';
    }

    function parts(sheetName, rows) {
        var safeName = escapeXml(String(sheetName || 'Sheet1').slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, ' '));
        return [
            {
                name: '[Content_Types].xml',
                data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                    '<Default Extension="xml" ContentType="application/xml"/>' +
                    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                    '</Types>'
            },
            {
                name: '_rels/.rels',
                data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                    '</Relationships>'
            },
            {
                name: 'xl/workbook.xml',
                data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                    '<sheets><sheet name="' + safeName + '" sheetId="1" r:id="rId1"/></sheets>' +
                    '</workbook>'
            },
            {
                name: 'xl/_rels/workbook.xml.rels',
                data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                    '</Relationships>'
            },
            { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows) }
        ];
    }

    function writeUint32(view, offset, value) { view.setUint32(offset, value, true); }
    function writeUint16(view, offset, value) { view.setUint16(offset, value, true); }

    /** Builds a ZIP with every entry stored, not deflated. */
    function zip(files) {
        var entries = files.map(function (file) {
            var nameBytes = encoder.encode(file.name);
            var dataBytes = encoder.encode(file.data);
            return { nameBytes: nameBytes, dataBytes: dataBytes, crc: crc32(dataBytes) };
        });

        var localSize = entries.reduce(function (total, entry) {
            return total + 30 + entry.nameBytes.length + entry.dataBytes.length;
        }, 0);
        var centralSize = entries.reduce(function (total, entry) {
            return total + 46 + entry.nameBytes.length;
        }, 0);

        var buffer = new Uint8Array(localSize + centralSize + 22);
        var view = new DataView(buffer.buffer);
        var offset = 0;
        var offsets = [];

        entries.forEach(function (entry) {
            offsets.push(offset);
            writeUint32(view, offset, 0x04034b50);
            writeUint16(view, offset + 4, 20);      // version needed
            writeUint16(view, offset + 6, 0x0800);  // UTF-8 names
            writeUint16(view, offset + 8, 0);       // stored
            writeUint16(view, offset + 10, 0);      // time
            writeUint16(view, offset + 12, 0x21);   // date (1980-01-01)
            writeUint32(view, offset + 14, entry.crc);
            writeUint32(view, offset + 18, entry.dataBytes.length);
            writeUint32(view, offset + 22, entry.dataBytes.length);
            writeUint16(view, offset + 26, entry.nameBytes.length);
            writeUint16(view, offset + 28, 0);      // no extra field
            offset += 30;
            buffer.set(entry.nameBytes, offset); offset += entry.nameBytes.length;
            buffer.set(entry.dataBytes, offset); offset += entry.dataBytes.length;
        });

        var centralStart = offset;
        entries.forEach(function (entry, index) {
            writeUint32(view, offset, 0x02014b50);
            writeUint16(view, offset + 4, 20);      // version made by
            writeUint16(view, offset + 6, 20);      // version needed
            writeUint16(view, offset + 8, 0x0800);
            writeUint16(view, offset + 10, 0);
            writeUint16(view, offset + 12, 0);
            writeUint16(view, offset + 14, 0x21);
            writeUint32(view, offset + 16, entry.crc);
            writeUint32(view, offset + 20, entry.dataBytes.length);
            writeUint32(view, offset + 24, entry.dataBytes.length);
            writeUint16(view, offset + 28, entry.nameBytes.length);
            writeUint16(view, offset + 30, 0);
            writeUint16(view, offset + 32, 0);
            writeUint16(view, offset + 34, 0);
            writeUint16(view, offset + 36, 0);
            writeUint32(view, offset + 38, 0);
            writeUint32(view, offset + 42, offsets[index]);
            offset += 46;
            buffer.set(entry.nameBytes, offset); offset += entry.nameBytes.length;
        });

        writeUint32(view, offset, 0x06054b50);
        writeUint16(view, offset + 4, 0);
        writeUint16(view, offset + 6, 0);
        writeUint16(view, offset + 8, entries.length);
        writeUint16(view, offset + 10, entries.length);
        writeUint32(view, offset + 12, offset - centralStart);
        writeUint32(view, offset + 16, centralStart);
        writeUint16(view, offset + 20, 0);

        return buffer;
    }

    /** rows: array of arrays of string | number. Returns the file's bytes. */
    function build(sheetName, rows) {
        return zip(parts(sheetName, rows));
    }

    return { build: build, columnName: columnName, crc32: crc32 };
});
