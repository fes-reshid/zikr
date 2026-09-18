/* Transactional email through Resend. */

const ENDPOINT = 'https://api.resend.com/emails';

async function send(env, { to, subject, text, html }) {
    if (!env.RESEND_API_KEY) return { ok: false, skipped: 'no RESEND_API_KEY' };
    try {
        const response = await fetch(env.EMAIL_ENDPOINT || ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + env.RESEND_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                from: env.MAIL_FROM || 'Diin Islaam <noreply@diinislaam.com>',
                to: [to], subject, text, html
            })
        });
        return { ok: response.ok, status: response.status };
    } catch (err) {
        return { ok: false, status: 0, error: String(err) };
    }
}

function layout(heading, bodyHtml, actionUrl, actionLabel) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#e9e2cd;
font-family:Georgia,'Times New Roman',serif;color:#3c2f26;">
<div style="max-width:520px;margin:0 auto;background:#faf3e0;border:1px solid #d3ac5c;
border-radius:16px;padding:28px;">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;
color:#a97c25;">Diin Islaam</p>
<h1 style="margin:0 0 14px;font-size:24px;font-weight:normal;color:#1c2b46;">${heading}</h1>
${bodyHtml}
<p style="margin:24px 0 0;"><a href="${actionUrl}" style="display:inline-block;
background:#2e6b58;color:#faf3e0;text-decoration:none;padding:12px 26px;border-radius:30px;
font-weight:bold;">${actionLabel}</a></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8a7963;text-align:center;">
diinislaam.com &middot; you are receiving this because you signed in to the Qur'&#257;n Daily Tracker.</p>
</body></html>`;
}

export function sendLoginEmail(env, { to, link }) {
    return send(env, {
        to,
        subject: 'Your sign-in link — Qur’ān Daily Tracker',
        text: 'Sign in to the Qur’ān Daily Tracker:\n\n' + link +
            '\n\nThe link works once and expires in 15 minutes. ' +
            'If you did not ask to sign in, ignore this email.',
        html: layout(
            'Sign in',
            '<p style="margin:0;font-size:17px;line-height:1.5;">Tap the button to sign in. ' +
            'The link works once and expires in 15 minutes.</p>' +
            '<p style="margin:12px 0 0;font-size:15px;color:#6b5a49;">' +
            'If you did not ask to sign in, you can ignore this email.</p>',
            link, 'Sign in'
        )
    });
}

export function sendReminderEmail(env, { to, name, juz, readerUrl }) {
    const greeting = name ? 'Assalāmu ʿalaykum, ' + name : 'Assalāmu ʿalaykum';
    return send(env, {
        to,
        subject: 'You have not read Juz ' + juz + ' today',
        text: greeting + ',\n\nToday’s juz is Juz ' + juz +
            ' and it is not marked as read yet. If there is no time to read it, ' +
            'at least listen to it:\n\n' + readerUrl + '\n',
        html: layout(
            'Today’s juz is still waiting',
            '<p style="margin:0;font-size:17px;line-height:1.5;">' + greeting +
            ', today’s reading is <strong>Juz ' + juz + '</strong>.</p>' +
            '<p style="margin:12px 0 0;font-size:17px;line-height:1.5;">' +
            'If there is no time to read it, at least listen to it.</p>',
            readerUrl, 'Listen to Juz ' + juz
        )
    });
}
