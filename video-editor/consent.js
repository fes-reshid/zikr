/*
 * Reel: purpose reminder, shown once per browser before the editor can be used —
 * the same reminder the site's audio editor shows, with an "I Agree" button that
 * stays disabled until the box is ticked.
 *
 * Loaded right after the <dialog id="consentGate"> markup, before the rest of the
 * page's scripts, so the dialog is open before anything else can be used.
 */
(function () {
    'use strict';

    const KEY = 've-consent-v1';
    const gate = document.getElementById('consentGate');
    if (!gate || typeof gate.showModal !== 'function') return;

    let agreed = false;
    try { agreed = localStorage.getItem(KEY) === 'yes'; } catch (err) { /* private mode: ask every time */ }
    if (agreed) return;

    const view = document.getElementById('consentView');
    const cancelled = document.getElementById('consentCancelled');
    const box = document.getElementById('consentCheck');
    const agree = document.getElementById('consentAgree');
    const decline = document.getElementById('consentDecline');
    const reconsider = document.getElementById('consentReconsider');

    box.addEventListener('change', function () { agree.disabled = !box.checked; });
    agree.addEventListener('click', function () {
        if (!box.checked) return;
        try { localStorage.setItem(KEY, 'yes'); } catch (err) { /* still let them in this time */ }
        gate.close();
    });
    // Not agreeing keeps the editor closed; it does not send anyone anywhere.
    decline.addEventListener('click', function () {
        view.hidden = true;
        cancelled.hidden = false;
        cancelled.querySelector('h1').focus();
        try { window.close(); } catch (err) { /* only works for script-opened tabs */ }
    });
    reconsider.addEventListener('click', function () {
        cancelled.hidden = true;
        view.hidden = false;
        document.getElementById('consentTitle').focus();
    });
    gate.addEventListener('cancel', function (e) { e.preventDefault(); }); // Escape does not close it
    gate.showModal();
}());
