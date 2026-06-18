function showToast(msg, type) { toast(msg, type || 'success'); }
function closeModal() { const m = document.getElementById('modalOverlay'); if (m) m.remove(); }

function showModal(title, body, buttons) {
  closeModal();
  const ov = document.createElement('div');
  ov.id = 'modalOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  ov.onclick = e => { if (e.target === ov) closeModal(); };
  const bx = document.createElement('div');
  bx.style.cssText = 'background:#101019;border:1px solid rgba(255,215,0,0.15);border-radius:12px;padding:24px;min-width:340px;max-width:460px';
  bx.innerHTML = `<div style="font-size:18px;font-weight:700;margin-bottom:16px">${title}</div><div>${body}</div>`;
  const ft = document.createElement('div');
  ft.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:20px';
  (buttons || []).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.class || 'btn-gold');
    btn.textContent = b.text;
    btn.onclick = b.action;
    ft.appendChild(btn);
  });
  bx.appendChild(ft);
  ov.appendChild(bx);
  document.body.appendChild(ov);
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function saveProfile() {
  const roblox_username = document.getElementById('robloxInput')?.value || '';
  const build = document.getElementById('buildInput')?.value || '';
  const build_items = document.getElementById('buildItemsInput')?.value || '';

  fetch('/api/update-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roblox_username, build, build_items }),
  })
  .then(r => r.json())
  .then(d => {
    if (d.success) {
      toast('Profile updated!', 'success');
      setTimeout(() => location.reload(), 1000);
    } else {
      toast('Error: ' + (d.error || 'Unknown'), 'error');
    }
  })
  .catch(() => toast('Network error', 'error'));
}
