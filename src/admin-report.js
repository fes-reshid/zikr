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
<!-- @xlsx-js -->

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
