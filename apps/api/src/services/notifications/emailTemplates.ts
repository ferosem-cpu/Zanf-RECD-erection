const BRAND = "Zan-F Power Systems";

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Renders subject/text/html for a notification templateKey. Only "otp_code" gets bespoke
 * copy - it's the template that actually needs to read well (it's the entire login flow for
 * customers/vendors). Every other key falls through to a generic rendering of its data so
 * nothing silently fails to send, without guessing at copy/tone for templates nobody asked
 * to have written yet.
 */
export function renderEmail(templateKey: string, data: Record<string, unknown>): RenderedEmail {
  if (templateKey === "otp_code") {
    const code = String(data.code ?? "");
    const context = data.orderNumber ? ` for order ${data.orderNumber}` : "";
    return {
      subject: `Your ${BRAND} sign-in code`,
      text: `Your one-time sign-in code${context} is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #111827;">${BRAND}</h2>
          <p>Your one-time sign-in code${context} is:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #111827; margin: 16px 0;">${code}</p>
          <p style="color: #6b7280; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    };
  }

  const label = templateKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const rows = Object.entries(data)
    .map(([key, value]) => `<tr><td style="padding:2px 8px 2px 0;color:#6b7280;">${key}</td><td>${String(value)}</td></tr>`)
    .join("");
  const textRows = Object.entries(data).map(([key, value]) => `${key}: ${value}`).join("\n");
  return {
    subject: `${BRAND} — ${label}`,
    text: `${label}\n\n${textRows}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #111827;">${BRAND}</h2>
        <p style="font-weight: 600;">${label}</p>
        <table style="font-size: 14px;">${rows}</table>
      </div>
    `,
  };
}
