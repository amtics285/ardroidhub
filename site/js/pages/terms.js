import { html, render } from "../ui.js";

export function renderTerms(el) {
  render(el, html`
    <article class="prose card pad">
      <h1>Developer policy</h1>
      <p>By publishing on AR DroidHub you agree to the rules below. We may remove any app at any time.</p>
      <h2>What you must not upload</h2>
      <ul>
        <li>Malware, spyware, stalkerware, ransomware or anything that harms users or their devices.</li>
        <li>Pirated, cracked or "modded" copies of other people's apps, or apps that copy someone else's work.</li>
        <li>Apps that pretend to be another company's app (name, icon or package name).</li>
        <li>Sexual or abusive content, or content that is illegal in India.</li>
      </ul>
      <h2>What you promise</h2>
      <ul>
        <li>You own the rights to the app, icon and screenshots you upload.</li>
        <li>Your app asks only for the permissions it really needs, and you explain what data it collects.</li>
        <li>You will fix problems and answer user reports quickly.</li>
      </ul>
      <h2>How checking works</h2>
      <p>Every upload is reviewed automatically within minutes. We check the APK file, its signature, permissions, screenshots and icon, the app text, and scan it for malware.
         <b>Your APK is uploaded to VirusTotal, which shares samples with the security community.</b>
         An app that breaks the rules above (malware, abusive or adult content, copied brands, piracy or cheating words) is rejected automatically, and we email you the reason so you can fix it and submit again.
         Automatic checks are not perfect, so a published app is not a guarantee of safety.</p>
      <h2>Reports</h2>
      <p>If you find a harmful or copied app, contact the developer or the store owner so it can be taken down.</p>
    </article>`);
}
