import type { Metadata } from "next";
import { Clause, LegalPage } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of service — Sitegrade",
  description: "The terms you agree to when you use Sitegrade.",
};

/**
 * Written to be read by the person agreeing to it. It is a starting point
 * drafted in plain language, not advice from a lawyer — have a lawyer in your
 * operating jurisdiction review it before taking money at any scale.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="3 October 2026">
      <Clause heading="Who we are">
        <p>
          Sitegrade is operated by the Sitegrade team (&quot;we&quot;,
          &quot;us&quot;). Contact us at support@sitegrade.app. These terms
          apply whenever you use the website or the service.
        </p>
      </Clause>

      <Clause heading="What the service does">
        <p>
          Sitegrade requests the publicly available version of a web page, the
          same way any visitor&apos;s browser would, and reports on what it
          finds. On a monitored site it repeats that request on a schedule and
          tells you what has changed since the previous check.
        </p>
        <p>
          We do not log in to anything, install anything on a website, or change
          anything about a website. We only read what is already public.
        </p>
      </Clause>

      <Clause heading="Your account">
        <p>
          You are responsible for keeping your password to yourself and for
          everything done with your account. Tell us promptly if you think
          someone else has access to it. You must be old enough to enter a
          contract where you live.
        </p>
      </Clause>

      <Clause heading="What you may and may not monitor">
        <p>
          You may audit and monitor any publicly reachable website, including
          sites you do not own — reading a public page is not restricted. What
          you may not do is use Sitegrade to generate load against a site, to
          circumvent a block, or as part of an attack.
        </p>
        <p>
          We cap how many free audits a single visitor can run per hour, and we
          may suspend an account that tries to work around that cap or that
          points the service at large numbers of sites in a way that amounts to
          scanning rather than monitoring.
        </p>
      </Clause>

      <Clause heading="Plans, payment and cancellation">
        <p>
          The free plan is free and does not expire. Paid plans are billed in
          advance, either monthly or annually, at the prices shown on the
          pricing page at the time you subscribe. We will tell you before any
          price change affects you.
        </p>
        <p>
          You can cancel at any time. Cancelling stops future charges; the plan
          runs to the end of the period you have already paid for, after which
          your account drops to the free plan&apos;s limits. We do not delete
          your sites or history when you downgrade.
        </p>
        <p>
          If something is genuinely broken on our side and we cannot fix it,
          email us and we will refund the unused part of your period.
        </p>
      </Clause>

      <Clause heading="What the reports are, and are not">
        <p>
          A Sitegrade report is an automated reading of a page at a moment in
          time. It is useful, and it is not exhaustive. It can miss problems, it
          can flag something that is intentional, and a passing score is not a
          guarantee that a website is secure, compliant, fast for every visitor,
          or working correctly.
        </p>
        <p>
          Use it as evidence to look into something, not as a certificate.
          Decisions you make on the basis of a report are yours.
        </p>
      </Clause>

      <Clause heading="Availability">
        <p>
          We work to keep the service up and the scheduled checks running, but
          we do not promise uninterrupted availability. A check can be delayed
          or missed — by our own downtime, by the target site, or by the network
          in between. Do not rely on Sitegrade as the only way you would find
          out that something has gone wrong.
        </p>
      </Clause>

      <Clause heading="Liability">
        <p>
          To the extent the law allows, we are not liable for indirect or
          consequential loss, including lost revenue, lost customers or lost
          data arising from your use of the service or from a problem the
          service failed to detect. Where liability cannot be excluded, it is
          limited to the amount you paid us in the twelve months before the
          claim.
        </p>
      </Clause>

      <Clause heading="Ending the agreement">
        <p>
          You can delete your account at any time from your account settings,
          which removes your sites, check history and alerts. We can suspend or
          close an account that breaches these terms, and will tell you why
          unless we are legally unable to.
        </p>
      </Clause>

      <Clause heading="Changes to these terms">
        <p>
          We may update these terms. If a change materially affects you, we will
          email the address on your account before it takes effect. Continuing
          to use the service after that means you accept the new terms.
        </p>
      </Clause>
    </LegalPage>
  );
}
