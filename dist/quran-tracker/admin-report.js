/*
 * The Qur'ān daily reading report, for kids-admin.html.
 *
 * Drops into an element with id="quran-tracker-report" and fills it with a
 * table of every registered student against each day in a range: ✅ where they
 * marked the day's juz complete, ❌ where they did not. It can be downloaded
 * as a .xlsx.
 *
 * The names come from Firestore, where the site already keeps them, and the
 * ticks come from the reminder API, which stores only user ids. The join
 * happens here, in the admin's own browser, so no name or address is ever
 * stored on the reminder server.
 *
 * Does nothing at all unless the mount element is present and the signed-in
 * user is an admin.
 */
/* src/xlsx.js, inlined by build.js — edit the source, not this file. */
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

(function () {
    'use strict';

    var mount = document.getElementById('quran-tracker-report');
    if (!mount) return;

    var API = mount.getAttribute('data-api') || '/quran-tracker/api/';
    var DEFAULT_DAYS = 7;
    var Xlsx = window.QuranXlsx;

    var students = [];
    var report = null;
    var loading = false;

    // --- Dates ------------------------------------------------------------
    function dayKey(date) {
        return date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
    }

    function shiftDays(key, delta) {
        var parts = key.split('-');
        var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        date.setDate(date.getDate() + delta);
        return dayKey(date);
    }

    function shortLabel(key) {
        var parts = key.split('-');
        var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    }

    // --- Markup -----------------------------------------------------------
    var style = document.createElement('style');
    style.textContent = [
        '#qt-report-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}',
        '#qt-report-table{border-collapse:collapse;width:100%;font-size:15px;}',
        '#qt-report-table th,#qt-report-table td{padding:8px 10px;border-bottom:1px solid rgba(169,124,37,.22);text-align:center;white-space:nowrap;}',
        '#qt-report-table th{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#8a7654;font-weight:700;}',
        '#qt-report-table td.qt-name,#qt-report-table th.qt-name{text-align:left;position:sticky;left:0;background:#fffdf6;}',
        '#qt-report-table tbody tr:hover td{background:rgba(169,124,37,.07);}',
        '#qt-report-table td.qt-today,#qt-report-table th.qt-today{background:rgba(46,107,88,.09);font-weight:700;}',
        '#qt-report-table .qt-sub{display:block;font-size:12px;color:#8a7654;font-weight:400;}',
        '.qt-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:14px;}',
        '.qt-controls label{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8a7654;font-weight:700;margin-bottom:4px;}',
        '.qt-controls input{padding:8px 10px;border-radius:8px;border:1px solid rgba(169,124,37,.5);font:inherit;}',
        '.qt-summary{font-size:15px;color:#6b5a49;margin:0 0 12px;}',
        '.qt-note{font-size:13px;color:#8a7654;margin:10px 0 0;}'
    ].join('\n');
    document.head.appendChild(style);

    mount.innerHTML =
        '<div class="card" id="qt-card" style="display:none;">' +
        '<h2>Qur’ān daily reading</h2>' +
        '<div class="qt-controls">' +
        '<div><label for="qt-from">From</label><input type="date" id="qt-from"></div>' +
        '<div><label for="qt-to">To</label><input type="date" id="qt-to"></div>' +
        '<button class="btn ghost small" id="qt-refresh">Refresh</button>' +
        '<button class="btn small" id="qt-download">Download Excel</button>' +
        '</div>' +
        '<p class="qt-summary" id="qt-summary"></p>' +
        '<div id="qt-report-wrap"></div>' +
        '<p class="qt-note">✅ marked the day’s juz complete · ❌ did not. ' +
        'Every registered student is listed, whether or not they have used the tracker.</p>' +
        '</div>';

    var card = document.getElementById('qt-card');
    var fromInput = document.getElementById('qt-from');
    var toInput = document.getElementById('qt-to');
    var refreshBtn = document.getElementById('qt-refresh');
    var downloadBtn = document.getElementById('qt-download');
    var summary = document.getElementById('qt-summary');
    var wrap = document.getElementById('qt-report-wrap');

    var today = dayKey(new Date());
    toInput.value = today;
    fromInput.value = shiftDays(today, -(DEFAULT_DAYS - 1));

    // --- Data -------------------------------------------------------------
    function studentName(student) {
        return student.fullName || student.displayName || student.username || student.uid;
    }

    /** Rows in the order they are shown, with the ticks resolved. */
    function buildRows() {
        if (!report) return [];
        return students.map(function (student) {
            var read = report.readings[student.uid] || [];
            var marks = report.days.map(function (day) {
                return read.indexOf(day) !== -1;
            });
            return {
                student: student,
                marks: marks,
                total: marks.filter(Boolean).length
            };
        }).sort(function (a, b) {
            // Most days read first, then alphabetically.
            if (b.total !== a.total) return b.total - a.total;
            return studentName(a.student).localeCompare(studentName(b.student));
        });
    }

    function render() {
        if (loading) {
            summary.textContent = 'Loading…';
            wrap.innerHTML = '';
            return;
        }
        if (!report) {
            summary.textContent = 'Could not load the report.';
            wrap.innerHTML = '';
            return;
        }

        var rows = buildRows();
        var todayIndex = report.days.indexOf(today);
        var readToday = todayIndex === -1 ? null
            : rows.filter(function (row) { return row.marks[todayIndex]; }).length;

        summary.textContent = students.length + ' registered' +
            (readToday === null ? '' : ' · ' + readToday + ' read today') +
            ' · ' + report.days.length + ' day' + (report.days.length === 1 ? '' : 's') +
            ' shown';

        if (!students.length) {
            wrap.innerHTML = '<p class="empty">No students registered yet.</p>';
            return;
        }

        var html = '<table id="qt-report-table"><thead><tr>' +
            '<th class="qt-name">Student</th>';
        report.days.forEach(function (day) {
            var isToday = day === today;
            html += '<th class="' + (isToday ? 'qt-today' : '') + '" title="' + day + '">' +
                escapeHtml(shortLabel(day)) + (isToday ? '<span class="qt-sub">today</span>' : '') +
                '</th>';
        });
        html += '<th>Days read</th></tr></thead><tbody>';

        rows.forEach(function (row) {
            html += '<tr><td class="qt-name">' + escapeHtml(studentName(row.student)) +
                (row.student.username && row.student.username !== studentName(row.student)
                    ? '<span class="qt-sub">' + escapeHtml(row.student.username) + '</span>' : '') +
                '</td>';
            row.marks.forEach(function (mark, index) {
                html += '<td class="' + (report.days[index] === today ? 'qt-today' : '') + '">' +
                    (mark ? '✅' : '❌') + '</td>';
            });
            html += '<td><strong>' + row.total + '</strong> / ' + report.days.length + '</td></tr>';
        });

        wrap.innerHTML = html + '</tbody></table>';
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    async function load() {
        loading = true;
        render();
        try {
            var token = await window.KidsCloud.getIdToken();
            var url = API + 'admin/report?from=' + encodeURIComponent(fromInput.value) +
                '&to=' + encodeURIComponent(toInput.value);
            var results = await Promise.all([
                fetch(url, { headers: { authorization: 'Bearer ' + token } }),
                window.KidsCloud.adminListStudents()
            ]);
            if (!results[0].ok) throw new Error('report HTTP ' + results[0].status);
            report = await results[0].json();
            students = (results[1] || []).filter(function (s) { return !s.disabled; });
        } catch (err) {
            console.error('Could not load the Qur’ān reading report', err);
            report = null;
        }
        loading = false;
        render();
    }

    // --- Download ---------------------------------------------------------
    function download() {
        if (!report || !Xlsx) return;
        var rows = buildRows();

        var header = ['Student', 'Username'];
        report.days.forEach(function (day) { header.push(day); });
        header.push('Days read', 'Days shown');

        var grid = [header];
        rows.forEach(function (row) {
            var line = [studentName(row.student), row.student.username || ''];
            row.marks.forEach(function (mark) { line.push(mark ? '✅' : '❌'); });
            line.push(row.total, report.days.length);
            grid.push(line);
        });

        var name = 'quran-reading-' + report.from +
            (report.from === report.to ? '' : '-to-' + report.to);
        var bytes = Xlsx.build('Qur’ān daily', grid);
        var blob = new Blob([bytes], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name + '.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    refreshBtn.addEventListener('click', load);
    downloadBtn.addEventListener('click', download);
    fromInput.addEventListener('change', load);
    toInput.addEventListener('change', load);

    // --- Start ------------------------------------------------------------
    function begin() {
        if (!window.KidsCloud || !window.KidsCloud.onAdminAuth) return;
        window.KidsCloud.onAdminAuth(function (admin) {
            // Shown only to a signed-in admin; the API checks again anyway.
            var allowed = !!(admin && admin.role);
            card.style.display = allowed ? '' : 'none';
            if (allowed && !report) load();
        });
    }

    if (window.KidsCloud) begin();
    else window.addEventListener('kidscloud-ready', begin);
})();
