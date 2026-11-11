const fs = require('fs');

const roleMapping = {
  'verif-id': ['users-manager', 'professionals-manager'],
  'users-all': ['users-manager'],
  'professionals': ['professionals-manager'],
  'clients': ['users-manager'],
  'projects': ['content-manager'],
  'payments': ['financial-manager'],
  'audit': ['auditor', 'compliance-officer'],
  'analytics': ['analyst'],
  'moderation': ['moderator'],
  'security': ['auditor', 'compliance-officer'],
  'market': ['content-manager'],
  'subscriptions': ['financial-manager'],
  'disputes': ['moderator', 'support'],
  'reviews': ['moderator'],
  'companies': ['professionals-manager'],
  'portfolio': ['content-manager'],
  'promos': ['content-manager'],
  'quotes-admin': ['financial-manager'],
  'push': [],
  'messaging': ['moderator'],
  'support': ['support'],
  'deleted': ['users-manager'],
};

let html = fs.readFileSync('index.html', 'utf8');

for (const [section, roles] of Object.entries(roleMapping)) {
  if (roles.length === 0) continue;
  
  const regex = new RegExp(`data-section="${section}"([^>]*?)(?=\s*onclick)`, 'g');
  
  if (regex.test(html)) {
    html = html.replace(regex, `data-section="${section}"$1 data-role-only="${roles.join(' ')}"`);
    console.log(`✅ ${section} → ${roles.join(', ')}`);
  }
}

fs.writeFileSync('index.html', html);
console.log('\n✅ All role attributes added!');
