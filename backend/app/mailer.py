"""Outgoing email through Resend's HTTP API (https://resend.com), standard library only.

Without RESEND_API_KEY nothing is sent: the message is written to the server log instead, so local
development works without an account. The production compose file refuses to start without a key.

Check a server's mail settings by sending a test message:

    python -m app.mailer you@example.com
"""
import html
import json
import logging
import sys
import urllib.error
import urllib.request

from .config import settings

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
APP_NAME = "Face Attendance"
# Resend's shared test sender: it only delivers to the address the Resend account was opened with
TEST_SENDER = "onboarding@resend.dev"
# Resend rejects requests that carry no User-Agent (403, error 1010)
USER_AGENT = "face-attendance-api/2.0"


class EmailError(Exception):
    """The message was not accepted for delivery. `str()` is safe to log, not to show to users."""


def sender() -> str:
    """The From header: EMAIL_FROM, with the app's name added when it is a bare address."""
    configured = settings.email_from.strip() or TEST_SENDER
    return configured if "<" in configured else f"{APP_NAME} <{configured}>"


def send_email(to: str, subject: str, text: str, html_body: str) -> None:
    """Send one message, or raise EmailError. Blocks for up to `email_timeout_seconds`."""
    if not settings.resend_api_key:
        log.warning("RESEND_API_KEY is not set, so this email was NOT sent.\n  To: %s\n  Subject: %s\n%s",
                    to, subject, text)
        return
    request = urllib.request.Request(
        RESEND_URL,
        data=json.dumps({"from": sender(), "to": [to], "subject": subject, "text": text, "html": html_body}).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.email_timeout_seconds) as response:
            response.read()
    except urllib.error.HTTPError as err:
        reason = _resend_reason(err)
        log.error("Resend refused the email to %s (HTTP %s): %s", to, err.code, reason)
        raise EmailError(f"Resend refused the email (HTTP {err.code}): {reason}") from err
    except (urllib.error.URLError, OSError) as err:  # DNS, connection, TLS, timeout
        log.error("Could not reach Resend to email %s: %s", to, err)
        raise EmailError(f"Could not reach Resend: {err}") from err


def _resend_reason(err: urllib.error.HTTPError) -> str:
    """Resend's own explanation, e.g. an unverified sending domain or an invalid API key."""
    raw = err.read().decode("utf-8", errors="replace")[:500]
    try:
        body = json.loads(raw)
    except ValueError:
        return raw or err.reason
    if isinstance(body, dict) and body.get("message"):
        return str(body["message"])
    return raw


def send_verification_code(to: str, name: str, code: str) -> None:
    """The 6-digit code that confirms a new account's email address."""
    minutes = settings.email_code_minutes
    first_name = (name.split() or ["there"])[0]
    subject = f"{code} is your {APP_NAME} confirmation code"
    text = (
        f"Hello {first_name},\n\n"
        f"Your {APP_NAME} confirmation code is: {code}\n\n"
        f"Enter it where you are creating your account. The code works for {minutes} minutes.\n\n"
        "If you did not try to create an account, you can ignore this email: nothing happens without the code.\n"
    )
    html_body = f"""\
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1b3a5c">{APP_NAME}</p>
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">Confirm your email address</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hello {html.escape(first_name)}, enter this code where you are creating your account:</p>
  <p style="margin:0 0 16px;padding:16px;border-radius:12px;background:#eef3f9;color:#1b3a5c;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center">{code}</p>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569">The code works for {minutes} minutes.</p>
  <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b">If you did not try to create an account, you can ignore this email: nothing happens without the code.</p>
</div>
"""
    send_email(to, subject, text, html_body)


def _main() -> int:
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        print("usage: python -m app.mailer you@example.com", file=sys.stderr)
        return 2
    if not settings.resend_api_key:
        print("RESEND_API_KEY is not set: nothing can be sent.", file=sys.stderr)
        return 1
    to = sys.argv[1]
    try:
        send_email(to, f"{APP_NAME}: email is working",
                   f"This is a test message from the {APP_NAME} server. Confirmation codes will arrive like this one.\n",
                   f"<p>This is a test message from the {APP_NAME} server. Confirmation codes will arrive like this one.</p>")
    except EmailError as err:
        print(f"Not sent (from {sender()}): {err}", file=sys.stderr)
        return 1
    print(f"Resend accepted a test message from {sender()} to {to}. Check that inbox (and its spam folder).")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sys.exit(_main())
