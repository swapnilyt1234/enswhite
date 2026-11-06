const clean = (value,max=1600) => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
export async function modelText(instructions, input, fallback, env = process.env) {
  if (env.AGENT_MODE !== 'llm') return { text: fallback, source: 'offline deterministic content' };
  if(!env.OPENAI_API_KEY||!env.OPENAI_MODEL)throw new Error('Configure the private model and API key; no offline substitute was used.');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env.OPENAI_MODEL, instructions, input: clean(input,8000), store: false, max_output_tokens: 1400 }),
    });
    if (!response.ok) throw new Error('Model unavailable');
    const result = await response.json();
    if(result.status==='incomplete'||result.error)throw new Error('Incomplete model output');
    const text = result.output?.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
    if (!text) throw new Error('Empty response');
    return { text: clean(text,6000), source: 'OpenAI model' };
  } catch { throw new Error('Model delivery unavailable. No offline substitute was presented as AI work.'); }
}

export async function vendorWork(vendor, task, env) {
  const business=clean(task.match(/^Business:\s*(.+)$/im)?.[1]||'Our studio').slice(0,70);
  const offer=clean(task.match(/^Offer:\s*(.+)$/im)?.[1]||'Discover our latest work').slice(0,240);
  const mission=clean(task.match(/^Mission:\s*(.+)$/im)?.[1]||task).replace(/^(write|create|make|design)\s+.*?\s+for:\s*/i,'').slice(0,120);
  const headline=clean(task.match(/^Headline:\s*(.+)$/im)?.[1]||(/diwali/i.test(mission)?`${business}: light up Diwali`:`${business}: ${mission.replace(/[.!]$/,'')}`)).replace(/^#+\s*/,'').slice(0,100);
  if(vendor==='lingualink'&&env.AGENT_MODE!=='llm'&&task.includes('Founder-sourced FAQ:'))return{type:'text',source:'offline source-preserving FAQ',content:`${business} · ${/Marathi/.test(task)?'मराठी':'हिन्दी'} customer help draft\nOffline mode: source answers are preserved verbatim; translation has not been performed.\n\n${task.split('Founder-sourced FAQ:\n')[1]}`};
  if (vendor === 'pixelpress') {
    const product=clean(task.match(/^Product:\s*(.+)$/im)?.[1]||mission).slice(0,75);
    const xml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
    const words=headline.split(/\s+/),lines=[''];for(const word of words){const last=lines.length-1;if(lines[last].length+word.length>30&&last<2)lines.push(word);else lines[last]+=(lines[last]?' ':'')+word}
    const palette=task.match(/^Brand colours:\s*(.+)$/im)?.[1]?.match(/#[a-f0-9]{6}\b/gi)||[];
    const image = { type: 'svg', source: 'deterministic SVG renderer', content: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560" viewBox="0 0 1000 560"><title>${xml(headline)}</title><rect width="1000" height="560" rx="30" fill="#163b32"/><circle cx="900" cy="50" r="190" fill="#cee2ae"/><circle cx="950" cy="520" r="120" fill="#dbad63"/><text x="60" y="90" fill="#cee2ae" font-family="sans-serif" font-size="22">${xml(business)}</text>${lines.map((line,i)=>`<text x="60" y="${200+i*65}" fill="#fff8e8" font-family="serif" font-size="52">${xml(line)}</text>`).join('')}<text x="60" y="430" fill="#dfe8d4" font-family="sans-serif" font-size="18">${xml(product)}</text><rect x="60" y="465" width="200" height="54" rx="27" fill="#cee2ae"/><text x="88" y="500" fill="#163b32" font-family="sans-serif" font-size="20">Explore collection</text></svg>` };
    if(palette.length)image.content=image.content.replaceAll('#163b32',palette[0]).replaceAll('#cee2ae',palette[1]||'#cee2ae');
    return image;
  }
  const fallback = vendor === 'copydesk'
    ? `${headline}\n\nMeet ${business}. ${offer}. ${/diwali/i.test(mission)?'Make this Diwali a little more meaningful.':'Discover what we are making for our community.'}\n\nContact our team to learn more and check current availability.`
    : /marathi|मराठी/i.test(task)
      ? `वारंवार विचारले जाणारे प्रश्न\n\nप्रश्न: मी ऑर्डर कशी देऊ?\nउत्तर: अॅपमध्ये आपले आवडते उत्पादन निवडा आणि ऑर्डर पूर्ण करा.\n\nप्रश्न: मदत कुठे मिळेल?\nउत्तर: अॅपमधून आमच्या सहाय्य पथकाशी संपर्क साधा.\n\nप्रश्न: उपलब्धता कशी तपासू?\nउत्तर: उपलब्धतेची माहिती उत्पादन पृष्ठावर पाहा.`
      : `अक्सर पूछे जाने वाले प्रश्न\n\nप्रश्न: मैं ऑर्डर कैसे करूँ?\nउत्तर: ऐप में अपना पसंदीदा उत्पाद चुनें और ऑर्डर पूरा करें।\n\nप्रश्न: सहायता कहाँ मिलेगी?\nउत्तर: हमारी सहायता टीम से ऐप के माध्यम से संपर्क करें।\n\nप्रश्न: उपलब्धता कैसे जाँचें?\nउत्तर: उपलब्धता और ऑफ़र की जानकारी उत्पाद पृष्ठ पर देखें।`;
  const output = await modelText(vendor === 'copydesk' ? 'Write concise, usable advertising copy for the brief. No fabricated discounts, availability claims or payment instructions. Plain text.' : 'Translate a short, useful customer FAQ into Hindi, or Marathi if requested. Do not invent campaign dates or discounts. Plain text.', task, fallback, env);
  if(vendor==='lingualink'&&output.source.startsWith('seeded fallback'))output.text=`${business}\n${/diwali/i.test(mission)?(/marathi/i.test(task)?'दिवाळी मोहिमेसाठी ग्राहक मदत':'दिवाली अभियान के लिए ग्राहक सहायता'):(/marathi/i.test(task)?'आमच्या नवीन मोहिमेसाठी ग्राहक मदत':'हमारे नए अभियान के लिए ग्राहक सहायता')}\n\n${output.text}`;
  return { type: 'text', content: output.text, source: output.source };
}
