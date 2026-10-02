import type { Metadata } from "next";
import { Clause, LegalPage } from "@/components/legal";
import { AUDITS_PER_HOUR } from "@/lib/rate-limit";

export const metadata: Metadata = {
  title: "Privacy policy — Sitegrade",
  description: "What Sitegrade stores, why, and how to get rid of it.",
};

/**
 * Describes what the code actually does. If the code changes, this page has
 * to change with it — a privacy policy that doesn't match the schema is worse
 * than none at all.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="3 October 2026">
      <Clause heading="The short version">
        <p>
          We store your email address, a hashed password, which websites you
          asked us to watch, and the results of the checks we ran on them. We
          do not sell any of it, we do not run advertising trackers, and you can
          delete the whole lot yourself from your account settings.
        </p>
      </Clause>

      <Clause heading="What we collect when you have an account">
        <p>
          <strong className="text-ink">Your email address</strong>, so we can
          sign you in and send alerts. <strong className="text-ink">A hash of
          your password</strong> — the password itself is never stored and we
          cannot read it.
        </p>
        <p>
          <strong className="text-ink">The sites you monitor</strong>: the
          address, the label you gave it, how often to check, and where alerts
          should go. <strong className="text-ink">The check history</strong>:
          one record per run, holding the score and the findings, so we can show
          you a trend and work out what changed.
        </p>
      </Clause>

      <Clause heading="What we collect when you don't">
        <p>
          The free audit needs no account and creates no account. To stop the
          audit being used as a weapon against other people&apos;s websites, we
          record your IP address when you run one, purely to count how many you
          have run in the last hour — the cap is {AUDITS_PER_HOUR}. Those
          records are deleted automatically after a few hours and are never
          linked to a person, an email address or an account.
        </p>
      </Clause>

      <Clause heading="Websites you check">
        <p>
          When you check a website we fetch its public homepage and keep the
          findings. We do not keep a copy of the page itself. We do not contact
          the owner of a site you check, and we do not tell anyone which sites
          you looked at.
        </p>
      </Clause>

      <Clause heading="Cookies">
        <p>
          One cookie, holding your signed-in session. It is httpOnly, so
          scripts on the page cannot read it, and it expires after thirty days
          or when you log out. There are no advertising, analytics or
          cross-site tracking cookies, which is why this site has no cookie
          banner — there is nothing to ask you to consent to.
        </p>
      </Clause>

      <Clause heading="Who else sees your data">
        <p>
          Only the services it takes to run the product: our hosting provider,
          our database provider, and our email provider for sending the alerts
          you asked for. Each one only receives what that job needs. Nobody
          buys this data and nobody is given it for marketing.
        </p>
      </Clause>

      <Clause heading="How long we keep it">
        <p>
          Your account and its history stay until you delete them. Check history
          is the product, so we keep it for as long as you watch the site. The
          IP counters behind the free audit are deleted within hours.
        </p>
      </Clause>

      <Clause heading="Your control over it">
        <p>
          Change your password or the address alerts go to from your account
          settings. Remove a site to delete its history. Delete your account to
          remove everything at once — it is immediate and it is not
          recoverable, so export anything you want to keep first.
        </p>
        <p>
          Depending on where you live you may also have the right to ask for a
          copy of your data or to object to how we handle it. Email
          support@sitegrade.app and we will deal with it.
        </p>
      </Clause>

      <Clause heading="Children">
        <p>
          Sitegrade is a tool for people running or building websites
          professionally. It is not directed at children and we do not knowingly
          collect their information.
        </p>
      </Clause>

      <Clause heading="Changes">
        <p>
          If we start collecting something new, this page changes first and we
          email account holders when the change is material. The date at the top
          always reflects the current version.
        </p>
      </Clause>
    </LegalPage>
  );
}
