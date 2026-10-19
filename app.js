const SUPABASE_URL = 'https://iwjkbvysxcwakgybaagw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_I5k7n8hvjxyCLypRbI5FyQ_2eo0b0Bz';
const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function showStatus(message, type = 'info', element = $('.form-status')) {
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${type}`;
}

async function findSchools(query) {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await client.from('schools').select('id,name,city,state').ilike('name', `%${query.trim()}%`).order('name').limit(8);
  if (error) throw error;
  return data || [];
}

function setSchoolPicker(form) {
  const input = $('[name="school-search"]', form); if (!input) return;
  const schoolId = $('[name="school-id"]', form), results = $('.school-results', form);
  let timer;
  input.addEventListener('input', () => {
    schoolId.value = ''; clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const schools = await findSchools(input.value);
        results.innerHTML = schools.map((school) => `<button type="button" data-id="${school.id}" data-name="${escapeHtml(school.name)}">${escapeHtml(school.name)}<span>${escapeHtml([school.city, school.state].filter(Boolean).join(', '))}</span></button>`).join('') || '<p class="quiet">No matching school found.</p>';
        results.hidden = false;
      } catch { results.innerHTML = '<p class="quiet">School search is temporarily unavailable.</p>'; results.hidden = false; }
    }, 220);
  });
  results.addEventListener('click', (event) => {
    const option = event.target.closest('button[data-id]'); if (!option) return;
    schoolId.value = option.dataset.id; input.value = option.dataset.name; results.hidden = true;
  });
}

async function finishOnboarding() {
  const raw = localStorage.getItem('fi_pending_onboarding'); if (!raw) return;
  const pending = JSON.parse(raw);
  const { data: membership } = await client.from('chapter_members').select('chapter_id').limit(1);
  if (membership?.length) { localStorage.removeItem('fi_pending_onboarding'); return; }
  const request = pending.mode === 'teacher'
    ? client.rpc('create_chapter', { selected_school_id: pending.schoolId, chapter_name: pending.chapterName || null })
    : client.rpc('join_chapter', { chapter_code: pending.joinCode, selected_school_id: pending.schoolId });
  const { error } = await request;
  if (!error) localStorage.removeItem('fi_pending_onboarding');
  else sessionStorage.setItem('fi_onboarding_error', error.message);
}

function initializeHub() {
  const requested = new URLSearchParams(location.search).get('mode') || 'student';
  const form = $('.auth-form'); setSchoolPicker(form);
  const loginButton = document.createElement('button');
  loginButton.type = 'button'; loginButton.dataset.authMode = 'login'; loginButton.textContent = 'Sign in';
  $('.auth-switch').append(loginButton);
  const setMode = (mode) => {
    document.body.dataset.authMode = mode;
    document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
    $('.hub-mode-title').textContent = mode === 'teacher' ? 'Start a chapter' : mode === 'login' ? 'Welcome back' : 'Join your chapter';
    $('.hub-mode-description').textContent = mode === 'teacher' ? 'Create the chapter for your school. After confirming your email, you will receive a join code for students.' : mode === 'login' ? 'Sign in to your First Invention learning hub.' : 'Create your own account, choose your school, and enter the code from your teacher.';
    $('.chapter-name-field').hidden = mode !== 'teacher'; $('.join-code-field').hidden = mode !== 'student';
    $('.form-grid').hidden = mode === 'login';
    $('[name="school-search"]', form).closest('label').hidden = mode === 'login';
    $('[name="first_name"]', form).required = mode !== 'login';
    $('[name="last_name"]', form).required = mode !== 'login';
    $('[name="school-search"]', form).required = mode !== 'login';
    $('.auth-form .check').hidden = mode === 'login';
    $('.auth-form .check input').required = mode !== 'login';
    $('[type="submit"]', form).textContent = mode === 'login' ? 'Sign in' : 'Create account';
  };
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.authMode)));
  setMode(requested === 'teacher' ? 'teacher' : 'student');
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(form)), status = $('.form-status', form), mode = document.body.dataset.authMode;
    if (mode === 'login') {
      showStatus('Signing in…', 'info', status);
      const { error } = await client.auth.signInWithPassword({ email: values.email, password: values.password });
      if (error) return showStatus(error.message, 'error', status);
      location.href = 'dashboard.html'; return;
    }
    if (!values['school-id']) return showStatus('Choose your school from the search results first.', 'error', status);
    if (mode === 'student' && !values.join_code.trim()) return showStatus('Enter the chapter code from your teacher.', 'error', status);
    showStatus('Creating your account…', 'info', status);
    const redirect = `${location.origin}${location.pathname.replace('hub.html', 'dashboard.html')}`;
    const { data, error } = await client.auth.signUp({ email: values.email, password: values.password, options: { emailRedirectTo: redirect, data: { first_name: values.first_name, last_name: values.last_name } } });
    if (error) return showStatus(error.message, 'error', status);
    localStorage.setItem('fi_pending_onboarding', JSON.stringify({ mode, schoolId: values['school-id'], chapterName: values.chapter_name, joinCode: values.join_code }));
    if (data.session) { await finishOnboarding(); location.href = 'dashboard.html'; }
    else showStatus('Check your email to confirm your account. Return through that link to finish joining your chapter.', 'success', status);
  });
}

function renderNoChapter() { $('.dashboard-content').innerHTML = '<section class="dashboard-card"><p class="eyebrow">Your account is ready</p><h2>Finish joining a chapter.</h2><p>Use the school and chapter code from your teacher, or start a new chapter as an advisor.</p><a class="button" href="hub.html">Go to chapter setup</a></section>'; }

async function renderChapter(membership) {
  const chapter = membership.chapters, { data: userData } = await client.auth.getUser();
  const [{ data: notes }, { data: lessons }] = await Promise.all([
    client.from('member_notifications').select('message,created_at').eq('user_id', userData.user.id).order('created_at', { ascending: false }).limit(3),
    client.from('lessons').select('number,title,unit').eq('published', true).order('number')
  ]);
  const official = chapter.status === 'official'; let teacherCard = '';
  if (membership.member_role === 'teacher') {
    const { count } = await client.from('chapter_members').select('*', { count: 'exact', head: true }).eq('chapter_id', chapter.id).eq('member_role', 'student');
    teacherCard = `<article class="dashboard-card"><p class="eyebrow">Teacher controls</p><h2>Invite your class</h2><p>Share this code privately with students at ${escapeHtml(chapter.schools?.name || 'your school')}.</p><div class="join-code">${escapeHtml(chapter.join_code)}</div><p><strong>${count || 0} of 10 students joined</strong> · ${official ? 'Your chapter is official.' : 'Activation happens at 10 confirmed students.'}</p></article>`;
  }
  $('.dashboard-content').innerHTML = `<section class="dashboard-hero"><div><p class="eyebrow">${official ? 'Official chapter' : 'Forming chapter'}</p><h1>${escapeHtml(chapter.name)}</h1><p>${escapeHtml(chapter.schools?.name || '')}</p></div><div class="status-pill ${official ? 'official' : ''}">${official ? 'Chapter activated' : 'Building your class'}</div></section><div class="dashboard-status"></div>${(notes || []).map((note) => `<div class="notice success"><strong>First Invention update</strong><br>${escapeHtml(note.message)}</div>`).join('')}${teacherCard}<section class="dashboard-card"><p class="eyebrow">Your class</p><h2>Lessons and resources</h2><p>${official ? 'Published lessons appear below.' : 'Your class can prepare now. Lesson packages appear here as they are published.'}</p><div class="lesson-list">${(lessons || []).map((lesson) => `<a href="program.html" class="lesson-row"><span>${String(lesson.number).padStart(2, '0')}</span><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.unit || '')}</small></a>`).join('') || '<p class="quiet">No lesson packages are published yet. Videos, slides, build guides, and exit tickets will appear here as they are completed.</p>'}</div></section><div class="dashboard-grid"><article class="dashboard-card"><p class="eyebrow">Competition pathways</p><h3>Find your next challenge</h3><p>Vetted invention and STEM competition opportunities will appear here.</p><a href="competitions.html">View pathways</a></article><article class="dashboard-card"><p class="eyebrow">Mentor Exchange</p><h3>Get project guidance</h3><p>Mentor matching is being built for founding chapters.</p><a href="advisors.html">Learn about mentorship</a></article></div>`;
}

async function renderAdmin() {
  const [{ data: chapters }, { data: notes }] = await Promise.all([
    client.from('chapters').select('name,status,schools(name)').order('created_at', { ascending: false }), client.from('chapter_notifications').select('message,created_at').order('created_at', { ascending: false }).limit(20)
  ]);
  $('.dashboard-content').innerHTML = `<section class="dashboard-card"><p class="eyebrow">Administrator view</p><h2>Chapter activation queue</h2><p>Official chapters appear here for chapter-kit review.</p><div class="lesson-list">${(chapters || []).map((chapter) => `<div class="lesson-row"><span class="status-dot ${chapter.status}"></span><strong>${escapeHtml(chapter.name)}</strong><small>${escapeHtml(chapter.schools?.name || '')} · ${escapeHtml(chapter.status)}</small></div>`).join('') || '<p class="quiet">No chapters have been created yet.</p>'}</div></section><section class="dashboard-card"><p class="eyebrow">Notifications</p><h2>Activation notices</h2>${(notes || []).map((note) => `<div class="notice"><strong>${escapeHtml(note.message)}</strong><br><small>${new Date(note.created_at).toLocaleString()}</small></div>`).join('') || '<p class="quiet">No activation notices yet.</p>'}</section>`;
}

async function initializeDashboard() {
  const { data: { session } } = await client.auth.getSession(); if (!session) { location.replace('hub.html'); return; }
  await finishOnboarding();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    client.from('profiles').select('first_name,role').eq('id', session.user.id).single(), client.from('chapter_members').select('chapter_id,member_role,chapters(id,name,join_code,status,schools(name))').eq('user_id', session.user.id).maybeSingle()
  ]);
  $('.dashboard-name').textContent = profile?.first_name ? `${profile.first_name}'s Hub` : 'My First Invention Hub';
  $('.sign-out').addEventListener('click', async () => { await client.auth.signOut(); location.replace('hub.html'); });
  if (profile?.role === 'admin') return renderAdmin(); if (!membership) return renderNoChapter(); return renderChapter(membership);
}

if (client && document.body.dataset.page === 'hub') initializeHub();
if (client && document.body.dataset.page === 'dashboard') initializeDashboard();

document.querySelectorAll('.nav-links').forEach((nav) => {
  if (nav.querySelector('[href="hub.html"]')) return;
  const link = document.createElement('a');
  link.href = 'hub.html'; link.textContent = 'Member Hub'; link.className = 'button';
  nav.append(link);
});
