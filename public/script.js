function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function saveProfile() {
  const roblox_username = document.getElementById('robloxInput')?.value || '';
  const region = document.getElementById('regionInput')?.value || '';
  const build = document.getElementById('buildInput')?.value || '';
  const build_items = document.getElementById('buildItemsInput')?.value || '';

  fetch('/api/update-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roblox_username, region, build, build_items }),
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
