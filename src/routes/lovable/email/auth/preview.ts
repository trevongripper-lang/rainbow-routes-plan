// Safeguard: keep module-level imports minimal so a broken template or a
// renamed export in @react-email/components cannot crash sibling page SSR.
// Templates and the renderer are loaded lazily inside the POST handler.
import { createFileRoute } from '@tanstack/react-router'

const SITE_NAME = 'plantribetrips'
const SAMPLE_PROJECT_URL = 'https://plantribetrips.lovable.app'
const SAMPLE_EMAIL = 'user@example.test'

const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: { siteName: SITE_NAME, confirmationUrl: SAMPLE_PROJECT_URL },
  recovery: { siteName: SITE_NAME, confirmationUrl: SAMPLE_PROJECT_URL },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: { token: '123456' },
}

async function loadTemplate(type: string) {
  switch (type) {
    case 'signup':
      return (await import('@/lib/email-templates/signup')).SignupEmail
    case 'invite':
      return (await import('@/lib/email-templates/invite')).InviteEmail
    case 'magiclink':
      return (await import('@/lib/email-templates/magic-link')).MagicLinkEmail
    case 'recovery':
      return (await import('@/lib/email-templates/recovery')).RecoveryEmail
    case 'email_change':
      return (await import('@/lib/email-templates/email-change')).EmailChangeEmail
    case 'reauthentication':
      return (await import('@/lib/email-templates/reauthentication')).ReauthenticationEmail
    default:
      return null
  }
}

export const Route = createFileRoute('/lovable/email/auth/preview')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        const authHeader = request.headers.get('Authorization')
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let type: string
        try {
          const body = await request.json()
          type = body.type
        } catch {
          return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 })
        }

        const EmailTemplate = await loadTemplate(type)
        if (!EmailTemplate) {
          return Response.json({ error: `Unknown email type: ${type}` }, { status: 400 })
        }

        const [React, { render }] = await Promise.all([
          import('react'),
          import('@react-email/components'),
        ])

        const sampleData = SAMPLE_DATA[type] || {}
        const html = await render(React.createElement(EmailTemplate, sampleData))

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
