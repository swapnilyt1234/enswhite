const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function landingSection(content){
 const data=JSON.parse(content);
 const fields=['headline','body','cta'];
 if(!data||Object.keys(data).some(x=>!fields.includes(x))||fields.some(x=>typeof data[x]!=='string'||!data[x].trim()||data[x].length>(x==='body'?1600:160)))throw new Error('Landing section needs a headline, body and CTA.');
 // Model text becomes escaped semantic HTML; it cannot supply scripts, links or event handlers.
 return `<section aria-label="Campaign landing section" style="padding:48px;background:#163b32;color:#fff8e8;border-radius:24px;font-family:system-ui"><h1 style="font:48px/1.1 Georgia,serif">${escape(data.headline)}</h1><p style="font-size:20px;max-width:60ch">${escape(data.body)}</p><p style="display:inline-block;padding:14px 24px;background:#cee2ae;color:#163b32;border-radius:24px">${escape(data.cta)}</p></section>`;
}
