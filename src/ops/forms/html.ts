// Static lead form generator: a standalone accessible HTML page and an
// embeddable snippet (<form> + <script>), both posting straight to the
// form's inbox from the visitor's browser — no server of ours.
//
// Anti-spam: a honeypot input (`_hp`, visually hidden, skipped by
// keyboard and screen readers; bots fill it → the submission is dropped
// client side and again at ingestion) and a minimum fill time (submits
// faster than MIN_FILL_MS after load are refused with a message).

import type { FieldDef, ObjectDef } from "../../core/types";
import { DEFAULT_FIREBASE_INBOX, DEFAULT_FORM_TEXTS, type LeadFormDoc } from "./types";

export const MIN_FILL_MS = 2500;
export const HONEYPOT_NAME = "_hp";

// Field types a public form can collect.
export const FORM_FIELD_TYPES: readonly FieldDef["type"][] = [
  "text",
  "longText",
  "email",
  "phone",
  "url",
  "number",
  "currency",
  "percent",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiSelect",
  "rating",
  "tags",
];

export function isFormFieldType(type: FieldDef["type"]): boolean {
  return FORM_FIELD_TYPES.includes(type);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// JSON safe inside a <script> element.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function safeColor(c: string | undefined): string {
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : "#2563eb";
}

function inputFor(def: FieldDef, name: string, id: string, required: boolean, describedBy: string): string {
  const req = required ? ' required aria-required="true"' : "";
  const common = `id="${id}" name="${escapeHtml(name)}"${req} aria-describedby="${describedBy}"`;
  switch (def.type) {
    case "longText":
      return `<textarea ${common} rows="4"></textarea>`;
    case "email":
      return `<input type="email" ${common} autocomplete="email" inputmode="email">`;
    case "phone":
      return `<input type="tel" ${common} autocomplete="tel" inputmode="tel">`;
    case "url":
      return `<input type="url" ${common} autocomplete="url" placeholder="https://">`;
    case "number":
    case "currency":
    case "percent":
      return `<input type="number" ${common} step="any" inputmode="decimal">`;
    case "rating":
      return `<input type="number" ${common} min="1" max="5" step="1" inputmode="numeric">`;
    case "date":
      return `<input type="date" ${common}>`;
    case "datetime":
      return `<input type="datetime-local" ${common}>`;
    case "select":
      return `<select ${common}><option value="">—</option>${(def.options ?? []).map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join("")}</select>`;
    default: {
      const ac = name === "firstName" ? ' autocomplete="given-name"' : name === "lastName" ? ' autocomplete="family-name"' : name === "name" ? ' autocomplete="name"' : name === "jobTitle" ? ' autocomplete="organization-title"' : name === "city" ? ' autocomplete="address-level2"' : "";
      return `<input type="text" ${common}${ac}>`;
    }
  }
}

function fieldBlock(form: LeadFormDoc, object: ObjectDef, index: number): string {
  const f = form.fields[index];
  const def = object.fields.find((x) => x.id === f.field);
  if (!def || !isFormFieldType(def.type)) return "";
  const id = `acrm-${form.id}-${index}`;
  const label = escapeHtml(f.label || def.label);
  const star = f.required ? ' <span class="acrm-req" aria-hidden="true">*</span>' : "";
  const err = `${id}-err`;
  if (def.type === "boolean") {
    return `<div class="acrm-field acrm-check"><input type="checkbox" id="${id}" name="${escapeHtml(def.id)}" value="true"${f.required ? ' required aria-required="true"' : ""} aria-describedby="${err}"><label for="${id}">${label}${star}</label><p class="acrm-err" id="${err}" hidden></p></div>`;
  }
  if (def.type === "multiSelect") {
    const opts = (def.options ?? [])
      .map((o, i) => `<label class="acrm-opt"><input type="checkbox" name="${escapeHtml(def.id)}" value="${escapeHtml(o.id)}" id="${id}-${i}"> ${escapeHtml(o.label)}</label>`)
      .join("");
    return `<fieldset class="acrm-field" aria-describedby="${err}"${f.required ? ' data-required="true"' : ""}><legend>${label}${star}</legend>${opts}<p class="acrm-err" id="${err}" hidden></p></fieldset>`;
  }
  const hint = def.type === "tags" ? `<p class="acrm-hint" id="${id}-hint">Separate values with commas.</p>` : "";
  return `<div class="acrm-field"><label for="${id}">${label}${star}</label>${inputFor(def, def.id, id, f.required, def.type === "tags" ? `${err} ${id}-hint` : err)}${hint}<p class="acrm-err" id="${err}" hidden></p></div>`;
}

// Client config embedded in the page (public by nature).
export interface FormClientConfig {
  formId: string;
  kind: LeadFormDoc["inbox"]["kind"];
  endpoint: string;
  format?: "json" | "form";
  extra?: Record<string, unknown>;
  successMessage: string;
  redirectUrl?: string;
  texts: typeof DEFAULT_FORM_TEXTS;
  fields: { name: string; type: string }[];
  minFillMs: number;
  // Admin live preview: nothing is sent.
  preview?: boolean;
}

export function formClientConfig(form: LeadFormDoc, object: ObjectDef): FormClientConfig {
  const s = form.inbox.settings ?? {};
  let endpoint = "";
  let extra: Record<string, unknown> | undefined;
  if (form.inbox.kind === "s3") {
    endpoint = (s.uploadUrl ?? "").trim();
    if (endpoint && !endpoint.endsWith("/")) endpoint += "/";
  } else if (form.inbox.kind === "firebase") {
    const collection = (s.collection || DEFAULT_FIREBASE_INBOX).trim();
    endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent((s.projectId ?? "").trim())}/databases/(default)/documents/${encodeURIComponent(collection)}?key=${encodeURIComponent((s.apiKey ?? "").trim())}`;
  } else {
    endpoint = (s.url ?? "").trim();
    if (s.extra) {
      try {
        const parsed = JSON.parse(s.extra) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed as Record<string, unknown>;
      } catch {
        // Invalid JSON is reported by validateForm.
      }
    }
  }
  const fields = form.fields
    .map((f) => object.fields.find((x) => x.id === f.field))
    .filter((d): d is FieldDef => !!d && isFormFieldType(d.type))
    .map((d) => ({ name: d.id, type: d.type }));
  return {
    formId: form.id,
    kind: form.inbox.kind,
    endpoint,
    ...(form.inbox.kind === "webhook" ? { format: s.format === "form" ? "form" : "json" } : {}),
    ...(extra ? { extra } : {}),
    successMessage: form.successMessage || "Thank you! We'll be in touch soon.",
    ...(form.redirectUrl ? { redirectUrl: form.redirectUrl } : {}),
    texts: { ...DEFAULT_FORM_TEXTS, ...Object.fromEntries(Object.entries(form.texts ?? {}).filter(([k, v]) => k in DEFAULT_FORM_TEXTS && typeof v === "string" && v.trim())) },
    fields,
    minFillMs: MIN_FILL_MS,
  };
}

// The submit script (ES2017, no dependency). Binds every
// form[data-agentcrm-form="<id>"] of the page once.
export function formScript(config: FormClientConfig): string {
  return `(function(){
var C=${scriptJson(config)};
function enc(v){if(typeof v==="string")return{stringValue:v};if(typeof v==="boolean")return{booleanValue:v};if(typeof v==="number")return{doubleValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(enc)}};if(v===null||v===undefined)return{nullValue:null};var f={};for(var k in v)f[k]=enc(v[k]);return{mapValue:{fields:f}};}
function rid(){var a=new Uint8Array(6);(window.crypto||{getRandomValues:function(x){for(var i=0;i<x.length;i++)x[i]=Math.random()*256|0;return x;}}).getRandomValues(a);return Array.prototype.map.call(a,function(b){return("0"+b.toString(16)).slice(-2)}).join("");}
function collect(form){var data={};C.fields.forEach(function(f){var els=form.querySelectorAll('[name="'+f.name+'"]');if(!els.length)return;if(f.type==="multiSelect"){var vals=[];els.forEach(function(e){if(e.checked)vals.push(e.value)});if(vals.length)data[f.name]=vals;return;}var el=els[0];if(f.type==="boolean"){data[f.name]=!!el.checked;return;}var v=(el.value||"").trim();if(!v)return;if(f.type==="tags"){data[f.name]=v.split(",").map(function(s){return s.trim()}).filter(Boolean);return;}if(f.type==="number"||f.type==="currency"||f.type==="percent"||f.type==="rating"){var n=Number(v);data[f.name]=isNaN(n)?v:n;return;}data[f.name]=v;});return data;}
function send(sub){var headers={};if(C.preview)return Promise.resolve({ok:true,status:200});if(C.kind==="s3"){return fetch(C.endpoint+encodeURIComponent(C.formId)+"/"+sub.createdAt+"-"+rid()+".json",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(sub)});}
if(C.kind==="firebase"){return fetch(C.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fields:{formId:enc(sub.formId),data:enc(sub.data),createdAt:{integerValue:String(sub.createdAt)}}})});}
var flat={};for(var k in sub.data)flat[k]=sub.data[k];if(C.extra)for(var x in C.extra)flat[x]=C.extra[x];flat._formId=sub.formId;flat._submittedAt=new Date(sub.createdAt).toISOString();flat._page=sub.meta.page;
if(C.format==="form"){var p=new URLSearchParams();for(var y in flat){var val=flat[y];p.append(y,Array.isArray(val)?val.join(", "):String(val));}return fetch(C.endpoint,{method:"POST",body:p});}
headers["content-type"]="application/json";headers.accept="application/json";return fetch(C.endpoint,{method:"POST",headers:headers,body:JSON.stringify(flat)});}
function bind(form){if(form.__acrm)return;form.__acrm=true;var t0=Date.now();var status=form.querySelector(".acrm-status");var btn=form.querySelector('button[type="submit"]');var label=btn?btn.querySelector(".acrm-btn-label"):null;
function say(msg,isErr){if(!status)return;status.textContent=msg;status.className="acrm-status"+(isErr?" acrm-status-err":"");status.hidden=!msg;}
form.addEventListener("submit",function(e){e.preventDefault();say("");
var groups=form.querySelectorAll('fieldset[data-required="true"]');for(var i=0;i<groups.length;i++){if(!groups[i].querySelector("input:checked")){var er=groups[i].querySelector(".acrm-err");if(er){er.textContent="Please choose at least one option.";er.hidden=false;}groups[i].querySelector("input").focus();return;}}
if(form.reportValidity&&!form.reportValidity())return;
var hp=form.querySelector('[name="${HONEYPOT_NAME}"]');if(hp&&hp.value){form.innerHTML='<p class="acrm-success" role="status"></p>';form.firstChild.textContent=C.successMessage;return;}
if(Date.now()-t0<C.minFillMs){say(C.texts.tooFast,true);return;}
var sub={formId:C.formId,data:collect(form),createdAt:Date.now(),meta:{page:location.href,referrer:document.referrer||"",elapsedMs:Date.now()-t0,lang:navigator.language||""}};
if(btn){btn.disabled=true;btn.setAttribute("aria-busy","true");}if(label)label.textContent=C.texts.sending;
send(sub).then(function(r){if(r&&r.type!=="opaque"&&!r.ok)throw new Error("HTTP "+r.status);if(C.redirectUrl){location.href=C.redirectUrl;return;}var p=document.createElement("p");p.className="acrm-success";p.setAttribute("role","status");p.setAttribute("tabindex","-1");p.textContent=C.successMessage;form.replaceChildren(p);p.focus();}).catch(function(){say(C.texts.error,true);if(btn){btn.disabled=false;btn.removeAttribute("aria-busy");}if(label)label.textContent=C.texts.submit;});});}
function init(){document.querySelectorAll('form[data-agentcrm-form="'+C.formId+'"]').forEach(bind);}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();`;
}

// The <form> markup shared by the page and the snippet.
export function formMarkup(form: LeadFormDoc, object: ObjectDef): string {
  const texts = { ...DEFAULT_FORM_TEXTS, ...(form.texts ?? {}) };
  const fields = form.fields.map((_f, i) => fieldBlock(form, object, i)).join("\n    ");
  return `<form class="acrm-form" data-agentcrm-form="${escapeHtml(form.id)}" data-form-type="other">
    ${fields}
    <div class="acrm-hp" aria-hidden="true"><label for="acrm-${escapeHtml(form.id)}-hp">Leave this field empty</label><input type="text" id="acrm-${escapeHtml(form.id)}-hp" name="${HONEYPOT_NAME}" tabindex="-1" autocomplete="off"></div>
    <p class="acrm-status" role="status" aria-live="polite" hidden></p>
    <button type="submit" class="acrm-btn"><span class="acrm-btn-icon" aria-hidden="true"></span><span class="acrm-btn-label">${escapeHtml(texts.submit)}</span></button>
  </form>`;
}

function formCss(accent: string, scope: string): string {
  return `${scope}{--acrm-accent:${accent};font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;box-sizing:border-box}
${scope} *{box-sizing:inherit}
${scope} .acrm-field{margin:0 0 1rem;border:0;padding:0}
${scope} label,${scope} legend{display:block;font-weight:600;font-size:.9rem;margin:0 0 .35rem}
${scope} .acrm-req{color:#b91c1c}
${scope} input[type=text],${scope} input[type=email],${scope} input[type=tel],${scope} input[type=url],${scope} input[type=number],${scope} input[type=date],${scope} input[type=datetime-local],${scope} select,${scope} textarea{width:100%;font:inherit;font-size:1rem;padding:.6rem .75rem;border:1px solid #d1d5db;border-radius:.5rem;background:#fff;color:inherit}
${scope} input:focus,${scope} select:focus,${scope} textarea:focus{outline:2px solid var(--acrm-accent);outline-offset:1px;border-color:var(--acrm-accent)}
${scope} .acrm-check{display:flex;gap:.5rem;align-items:flex-start}
${scope} .acrm-check label{font-weight:500;margin:0}
${scope} .acrm-opt{display:flex;gap:.5rem;align-items:center;font-weight:400;margin:.25rem 0}
${scope} .acrm-hint{font-size:.8rem;color:#6b7280;margin:.25rem 0 0}
${scope} .acrm-err,${scope} .acrm-status-err{color:#b91c1c;font-size:.85rem;margin:.25rem 0 0}
${scope} .acrm-status{margin:0 0 1rem}
${scope} .acrm-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
${scope} .acrm-btn{display:inline-flex;align-items:center;gap:.5rem;font:inherit;font-weight:600;font-size:1rem;padding:.7rem 1.4rem;border:0;border-radius:.5rem;background:var(--acrm-accent);color:#fff;cursor:pointer}
${scope} .acrm-btn:hover{filter:brightness(1.08)}
${scope} .acrm-btn:focus-visible{outline:3px solid var(--acrm-accent);outline-offset:2px}
${scope} .acrm-btn[disabled]{opacity:.6;cursor:progress}
${scope} .acrm-btn-icon:empty{display:none}
${scope} .acrm-success{font-size:1.05rem;padding:1rem;border-radius:.5rem;background:#ecfdf5;color:#065f46;outline:none}`;
}

export interface BuiltForm {
  html: string;
  embedSnippet: string;
  path: string;
  config: FormClientConfig;
}

export function defaultFormPath(form: Pick<LeadFormDoc, "id" | "name">): string {
  const slug = form.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `forms/${slug || form.id}/index.html`;
}

export function buildFormArtifacts(form: LeadFormDoc, object: ObjectDef, opts: { lang?: string; preview?: boolean } = {}): BuiltForm {
  const config = { ...formClientConfig(form, object), ...(opts.preview ? { preview: true, minFillMs: 0 } : {}) };
  const accent = safeColor(form.accentColor);
  const title = form.texts?.title?.trim() || form.name;
  const description = form.texts?.description?.trim();
  const markup = formMarkup(form, object);
  const script = formScript(config);
  const html = `<!doctype html>
<html lang="${escapeHtml(opts.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="generator" content="AgentCRM">
<title>${escapeHtml(title)}</title>
<style>
html{background:#f3f4f6}
body{margin:0;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:3rem 1rem}
main{width:100%;max-width:34rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06);padding:2rem}
h1{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:1.5rem;margin:0 0 .5rem;color:#111827}
.acrm-intro{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#4b5563;margin:0 0 1.5rem;line-height:1.5}
${formCss(accent, ".acrm-root")}
@media (prefers-color-scheme:dark){html{background:#111827}main{background:#1f2937}h1,.acrm-root{color:#f9fafb}.acrm-intro{color:#d1d5db}.acrm-root input,.acrm-root select,.acrm-root textarea{background:#111827!important;border-color:#374151!important}.acrm-root .acrm-success{background:#064e3b;color:#d1fae5}}
</style>
</head>
<body>
<main class="acrm-root">
<h1>${escapeHtml(title)}</h1>
${description ? `<p class="acrm-intro">${escapeHtml(description)}</p>\n` : ""}${markup}
</main>
<script>${script}</script>
</body>
</html>
`;
  const scope = `.acrm-embed-${form.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const embedSnippet = `<!-- AgentCRM lead form: ${escapeHtml(form.name).replace(/--/g, "—")} -->
<div class="${scope.slice(1)}">
<style>${formCss(accent, scope)}</style>
${markup}
</div>
<script>${script}</script>
`;
  return { html, embedSnippet, path: form.publishedPath || defaultFormPath(form), config };
}
