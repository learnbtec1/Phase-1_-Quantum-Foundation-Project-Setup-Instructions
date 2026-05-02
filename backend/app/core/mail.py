# -*- coding: utf-8 -*-
"""Transactional email via fastapi-mail (Mailtrap sandbox, Resend SMTP, etc.)."""
from __future__ import annotations

import html
import logging

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType

from app.core.config import settings

logger = logging.getLogger(__name__)


def mail_is_configured() -> bool:
    u = (settings.MAIL_USERNAME or settings.SMTP_USER or "").strip()
    p = (settings.MAIL_PASSWORD or settings.SMTP_PASSWORD or "").strip()
    return bool(u and p)


def get_mail_connection_config() -> ConnectionConfig:
    """Connection for fastapi-mail; prefers MAIL_* then falls back to legacy SMTP_*."""
    user = (settings.MAIL_USERNAME or settings.SMTP_USER or "").strip()
    password = (settings.MAIL_PASSWORD or settings.SMTP_PASSWORD or "").strip()
    host = (settings.MAIL_SERVER or settings.SMTP_HOST or "sandbox.smtp.mailtrap.io").strip()
    port = int(settings.MAIL_PORT or settings.SMTP_PORT or 2525)
    mail_from = (settings.MAIL_FROM or settings.SMTP_FROM or settings.SMTP_USER or "noreply@localhost").strip()

    return ConnectionConfig(
        MAIL_USERNAME=user,
        MAIL_PASSWORD=password,
        MAIL_SERVER=host,
        MAIL_PORT=port,
        MAIL_STARTTLS=True,
        MAIL_SSL_TLS=False,
        MAIL_FROM=mail_from,
        MAIL_FROM_NAME=(settings.MAIL_FROM_NAME or "EduVerse").strip(),
        USE_CREDENTIALS=True,
        VALIDATE_CERTS=True,
    )


def build_verification_email_html(verify_api_url: str) -> str:
    """Luxurious Arabic HTML (cognitive-refinement welcome); CTA points at API verify URL."""
    safe_url = html.escape(verify_api_url, quote=True)
    return f"""\
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>إيدوفيرس — تفعيل الحساب</title>
</head>
<body style="margin:0;padding:0;background-color:#020617;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg,#020617 0%,#0f172a 100%);padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:rgba(15,23,42,0.75);border-radius:20px;border:1px solid rgba(245,158,11,0.25);box-shadow:0 0 48px rgba(251,191,36,0.12);overflow:hidden;backdrop-filter:blur(12px);">
          <tr>
            <td style="padding:36px 32px 24px;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#94a3b8;">EduVerse</p>
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#fef3c7;background:linear-gradient(90deg,#fde68a,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                خطوة واحدة لتفعيل رحلتك في إيدوفيرس
              </h1>
              <p style="margin:0 0 20px;font-size:16px;line-height:1.75;color:#e2e8f0;">
                أهلًا بك — سواء كنت تبني تفكيرًا أكاديميًا دقيقًا كطالب، أو ترافق نمو الفهم كمربٍ.
                <strong>إيدوفيرس</strong> مصمم ليصقل مسار التعلم: وضوح المعايير، نزاهة المخرجات،
                ومساحة آمنة للنمو. لتكتمل انضمامك، يلزمنا تأكيد بريدك: لقطة واعية تربطك بمساحتك.
              </p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#94a3b8;">
                اضغط الزر أدناه — الرابط ساري للمدة المحدّدة في سياسة المنصة — لن تُطرح عليك أسئلة إضافية.
              </p>
              <div style="text-align:center;margin:28px 0 24px;">
                <a href="{safe_url}" target="_blank" rel="noopener noreferrer"
                  style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:700;text-decoration:none;color:#0f172a;border-radius:14px;
                  background:linear-gradient(135deg,#fde68a 0%,#f59e0b 45%,#d97706 100%);
                  box-shadow:0 0 28px rgba(245,158,11,0.45),0 0 0 1px rgba(253,230,138,0.35);">
                  تفعيل البريد والمتابعة
                </a>
              </div>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
                إن لم يعمل الزر، انسخ والصق هذا الرابط في المتصفح:<br />
                <span style="color:#94a3b8;">{safe_url}</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:12px;color:#64748b;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
          — فريق إيدوفيرس · مساحتك لرحلة تعلّم واعية
        </p>
      </td>
    </tr>
  </table>
</body>
</html>"""


def verification_api_url_for_token(raw_token: str) -> str:
    base = settings.BACKEND_PUBLIC_URL.rstrip("/")
    api = settings.API_V1_STR.strip() or "/api/v1"
    if not api.startswith("/"):
        api = f"/{api}"
    return f"{base}{api}/auth/verify-email?token={raw_token}"


async def send_verification_email_luxury(to_email: str, raw_token: str) -> None:
    """Sends the Arabic HTML verification message; CTA uses API URL (server verifies then redirects to SPA)."""
    verify_url = verification_api_url_for_token(raw_token)
    if not mail_is_configured():
        logger.info(
            "Email verification (dev): to=%s link=%s (set MAIL_USERNAME / MAIL_PASSWORD for Mailtrap)",
            to_email,
            verify_url,
        )
        return

    subj = "خطوة واحدة لتفعيل رحلتك في إيدوفيرس"
    body_html = build_verification_email_html(verify_url)

    message = MessageSchema(
        subject=subj,
        recipients=[to_email],
        body=body_html,
        subtype=MessageType.html,
    )
    conf = get_mail_connection_config()
    fm = FastMail(conf)
    await fm.send_message(message)
    logger.info("Verification email queued/sent to %s", to_email)
