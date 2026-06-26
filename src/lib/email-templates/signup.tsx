import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({ confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to finish setting up your Tribe Trips account.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Tribe Trips</Text>
        <Heading style={h1}>Confirm your Tribe Trips account</Heading>
        <Text style={text}>
          Welcome to Tribe Trips. Confirm your email address to finish setting up your account.
        </Text>

        <Section style={{ textAlign: "center" as const, margin: "32px 0" }}>
          <Button style={button} href={confirmationUrl}>
            Confirm my email
          </Button>
        </Section>

        <Text style={fallbackLabel}>
          If the button does not work, copy and paste this link into your browser:
        </Text>
        <Text style={fallbackUrl}>
          <Link href={confirmationUrl} style={fallbackLink}>
            {confirmationUrl}
          </Link>
        </Text>

        <Hr style={hr} />
        <Text style={footer}>
          If you didn't create a Tribe Trips account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default SignupEmail;

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};
const container = { padding: "32px 28px", maxWidth: "560px" };
const brand = {
  fontSize: "13px",
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "#0e7490",
  fontWeight: 600,
  margin: "0 0 8px",
};
const h1 = {
  fontSize: "24px",
  fontWeight: "bold" as const,
  color: "#0f172a",
  margin: "0 0 16px",
  lineHeight: "1.3",
};
const text = {
  fontSize: "15px",
  color: "#334155",
  lineHeight: "1.55",
  margin: "0 0 16px",
};
const button = {
  backgroundColor: "#0e7490",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "bold" as const,
  borderRadius: "8px",
  padding: "14px 28px",
  textDecoration: "none",
  display: "inline-block",
  border: "1px solid #0e7490",
};
const fallbackLabel = {
  fontSize: "13px",
  color: "#475569",
  margin: "24px 0 6px",
};
const fallbackUrl = {
  fontSize: "13px",
  color: "#0e7490",
  wordBreak: "break-all" as const,
  margin: "0 0 8px",
};
const fallbackLink = { color: "#0e7490", textDecoration: "underline" };
const hr = { borderColor: "#e2e8f0", margin: "28px 0 16px" };
const footer = { fontSize: "12px", color: "#94a3b8", margin: "0" };
