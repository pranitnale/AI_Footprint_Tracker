// Generated from the canvas board WebTerms (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { SOURCE_REPOSITORY_LABEL, SOURCE_REPOSITORY_URL } from "../repository";

export function WebTermsPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "56px", "paddingBottom": "28px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <span style={{ "fontSize": "13px", "fontWeight": "700", "letterSpacing": ".08em", "textTransform": "uppercase", "color": "#2E6B3F" }}>Legal</span>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(34px, 4vw, 52px)", "lineHeight": "1.08", "fontWeight": "800", "letterSpacing": "-.02em" }}>Terms of use</h1>
        <p className="lead">These terms apply to the AI Footprint Tracker browser extension, the website aifootprinttracker.com and the hosted service for organizations. Version of{" "}
          13 October 2026.</p></section>
      <section className="wrap" style={{ "paddingBottom": "88px" }}>
        <div className="doc">
          <nav className="toc" aria-label="On this page">
            <a href="#1-who-provides-the-service">1. Who provides the service</a>
            <a href="#2-what-the-services-are">2. What the services are</a>
            <a href="#3-free-of-charge">3. Free of charge</a>
            <a href="#4-registering-an-organization">4. Registering an organization</a>
            <a href="#5-members">5. Members</a>
            <a href="#6-the-organization-s-responsibilities">6. The organization's responsibilities</a>
            <a href="#7-acceptable-use">7. Acceptable use</a>
            <a href="#8-availability-and-changes">8. Availability and changes</a>
            <a href="#9-ending-the-use">9. Ending the use</a>
            <a href="#10-liability">10. Liability</a>
            <a href="#11-open-source-software">11. Open-source software</a>
            <a href="#12-privacy">12. Privacy</a>
            <a href="#13-changes-to-these-terms">13. Changes to these terms</a>
            <a href="#14-law-and-place-of-jurisdiction">14. Law and place of jurisdiction</a>
            <a href="#15-contact">15. Contact</a></nav>
          <article className="art">
            <h2 id="1-who-provides-the-service">1. Who provides the service</h2>
            <p>The services are provided by Pranit Jagannath Nale, email{" "}
              <a href="mailto:pranitnale42@gmail.com">pranitnale42@gmail.com</a> ("we", "us"). Further details are in the{" "}
              <a href="/imprint">Imprint</a>.</p>
            <h2 id="2-what-the-services-are">2. What the services are</h2>
            <ul>
              <li>
                <b>The extension</b> estimates the electricity, carbon and water behind your chats on supported AI sites. It counts in your browser and keeps its records there.</li>
              <li>
                <b>The hosted service</b> lets an organization collect the numbers of its members' connected browsers and see them on an admin site.</li>
              <li>
                <b>Self-hosting:</b> an organization can run the server software itself under its open-source license. We do not operate self-hosted servers. The organization that runs one is responsible for it.</li></ul>
            <p>The figures are estimates, not measurements. They follow the published methodology based on EcoLogits and come with a range. They are not a verified emissions report. If you use them in reports or decisions, you are responsible for checking that they are suitable for that purpose.</p>
            <h2 id="3-free-of-charge">3. Free of charge</h2>
            <p>The extension and the hosted service for organizations with up to 50 members are free of charge. We do not charge fees and do not show advertising. An organization with more than 50 members can{" "}
              <a href="/contact">contact us</a>; anything beyond these terms needs a separate written agreement. We never charge an organization without its express agreement.</p>
            <h2 id="4-registering-an-organization">4. Registering an organization</h2>
            <ul>
              <li>Only a person who may act for the organization may register it. By registering, that person confirms that they may.</li>
              <li>The registrant's work email must belong to the organization's work domain. Free email providers are not accepted.</li>
              <li>Each work domain can have one organization on the hosted service, unless we agree to an exception.</li>
              <li>The registrant becomes the first administrator. Administrators can give other members the administrator role.</li>
              <li>The information given at registration must be correct and kept up to date.</li></ul>
            <h2 id="5-members">5. Members</h2>
            <p>Any person with a work email on the organization's domain can connect a browser in the extension with an email code, up to the organization's member limit. Only administrators sign in on the website. Administrators can remove members and delete their records on the admin site.</p>
            <h2 id="6-the-organization-s-responsibilities">6. The organization's responsibilities</h2>
            <p>For its members' data, the organization is the controller under the GDPR and we process it on its behalf. The{" "}
              <a href="/dpa">Data processing agreement</a> is part of these terms for every organization on the hosted service. In particular, the organization is responsible for:</p>
            <ul>
              <li>having a legal basis for processing its members' usage data, and informing its members about it</li>
              <li>involving its works council or other employee representatives where the law requires it. In Germany, a system that can show the usage of individual employees is usually subject to co-determination (Section 87(1) No. 6 BetrVG).</li>
              <li>deciding who becomes an administrator, which policies apply and how long usage is kept</li>
              <li>keeping exported files safe; downloaded exports cannot be recalled</li></ul>
            <h2 id="7-acceptable-use">7. Acceptable use</h2>
            <p>You must not:</p>
            <ul>
              <li>attack, overload or probe the service, or get around its rate limits or access controls</li>
              <li>sign in with an email address that is not yours, or register an organization you may not act for</li>
              <li>send data that is not produced by the extension, or data that is unlawful</li>
              <li>use the service to break the law or the rights of others</li></ul>
            <h2 id="8-availability-and-changes">8. Availability and changes</h2>
            <p>We run the service with care, but because it is free we cannot promise a particular availability. We may change features when the methodology, the supported AI sites or the law require it. If we plan to end the hosted service, we tell administrators at least{" "}
              30 days in advance so they can export their data.</p>
            <h2 id="9-ending-the-use">9. Ending the use</h2>
            <ul>
              <li>
                <b>Members</b> can disconnect their browser at any time in the extension.</li>
              <li>
                <b>Organizations</b> can end their use at any time by writing to us. We then delete the organization's data within{" "}
                30 days, unless the law requires us to keep it. Administrators should export what they need first.</li>
              <li>
                <b>We</b> can suspend or end an organization's access if it seriously breaks these terms, after a warning where reasonable. We can end the hosted service with the notice in section 8.</li></ul>
            <h2 id="10-liability">10. Liability</h2>
            <p>We are liable without limitation for intent and gross negligence, for injury to life, body or health, under the Product Liability Act, and where we give a guarantee. Otherwise we are not liable, because we provide the services free of charge (compare Sections 521 and 599 of the German Civil Code).</p>
            <h2 id="11-open-source-software">11. Open-source software</h2>
            <p>The source code of the extension and the server is published under its open-source license at{" "}
              <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">{SOURCE_REPOSITORY_LABEL}</a>. The license governs the code. These terms govern the use of our hosted service and website.</p>
            <h2 id="12-privacy">12. Privacy</h2>
            <p>How we handle personal data is described in the{" "}
              <a href="/privacy-policy">Privacy policy</a>.</p>
            <h2 id="13-changes-to-these-terms">13. Changes to these terms</h2>
            <p>We may change these terms when the service or the law changes. We tell administrators at least{" "}
              30 days before a change takes effect. An organization that does not agree can end its use before then.</p>
            <h2 id="14-law-and-place-of-jurisdiction">14. Law and place of jurisdiction</h2>
            <p>German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. If the organization is a merchant, a legal entity under public law or a special fund under public law, the place of jurisdiction is{" "}
              the provider's place of residence in Germany. Mandatory consumer protection rules of the country where a consumer lives remain unaffected.</p>
            <h2 id="15-contact">15. Contact</h2>
            <p>Questions about these terms:{" "}
              <a href="mailto:pranitnale42@gmail.com">pranitnale42@gmail.com</a> or the{" "}
              <a href="/contact">contact form</a>.</p></article></div></section>
    </>
  );
}
