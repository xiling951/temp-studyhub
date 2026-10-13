const targets = ['@ericwang1358/dsh-daily-flashcard', '@ericwang1358/dsh-daily-flashcard/plugins/runtime', '@ericwang1358/dsh-daily-flashcard/plugins/materials', '@ericwang1358/dsh-daily-flashcard/client'];
for (const t of targets) {
  try { const m = await import(t); console.log('OK  ', t, '| exports:', Object.keys(m).slice(0, 6).join(',')); }
  catch (e) { console.log('FAIL', t, '|', e.code || '', e.message.split('\n')[0]); }
}
for (const t of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm']) {
  try { await import(t); console.log('peer OK  ', t); } catch (e) { console.log('peer MISS', t, '|', e.code || e.message.split('\n')[0]); }
}
