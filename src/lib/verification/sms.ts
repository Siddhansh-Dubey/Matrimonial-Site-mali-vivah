import 'server-only'

/**
 * Outbound SMS for mobile OTP codes — server-only.
 *
 * Provider: MSG91 "Send OTP" API (pass our own code + message), configured
 * via MSG91_AUTH_KEY + MSG91_SENDER_ID (+ optional MSG91_DLT_TEMPLATE_ID for
 * DLT scrubbing in India). When unconfigured (local dev), the code is logged
 * server-side and echoed back as `devCode` — the send route only includes
 * that field outside production, so there is no production leak path.
 */

export type SmsResult = { sent: boolean; provider: 'msg91' | 'dev' }

function msg91Configured(): boolean {
  return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID)
}

export async function sendOtpSms(mobile10: string, code: string): Promise<SmsResult> {
  const message = `Your Mali Vivah verification code is ${code}. It expires in 10 minutes. Never share it with anyone.`

  if (!msg91Configured()) {
    console.info(`[otp:sms:dev] code for ${mobile10}: ${code}`)
    return { sent: true, provider: 'dev' }
  }

  try {
    const params = new URLSearchParams({
      authkey: process.env.MSG91_AUTH_KEY as string,
      mobiles: `91${mobile10}`,
      message,
      sender: process.env.MSG91_SENDER_ID as string,
      otp: code,
      route: '4',
    })
    const dltId = process.env.MSG91_DLT_TEMPLATE_ID
    if (dltId) params.set('DLT_TE_ID', dltId)

    const res = await fetch(`https://control.msg91.com/api/v5/otp?${params.toString()}`, {
      method: 'GET',
    })
    if (!res.ok) {
      console.error(`[otp:sms] MSG91 HTTP ${res.status}`)
      return { sent: false, provider: 'msg91' }
    }
    const body = (await res.json().catch(() => null)) as { type?: string; message?: string } | null
    if (body && body.type && body.type.toLowerCase() !== 'success') {
      console.error(`[otp:sms] MSG91 rejected: ${body.message ?? body.type}`)
      return { sent: false, provider: 'msg91' }
    }
    return { sent: true, provider: 'msg91' }
  } catch (err) {
    console.error('[otp:sms] send failed:', err instanceof Error ? err.message : err)
    return { sent: false, provider: 'msg91' }
  }
}
