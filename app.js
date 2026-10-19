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
  const terms = query.toLowerCase().replace(/high school|high|school|h\.?s\.?/g, ' ').split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  const seed = terms[0] || query.trim().toLowerCase();
  const { data, error } = await client.from('schools').select('id,name,city,state,school_type').ilike('name', `%${seed}%`).order('name').limit(60);
  if (error) throw error;
  return (data || []).filter((school) => {
    const searchable = `${school.name} ${school.city} ${school.state}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  }).slice(0, 10);
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
    ? client.rpc('create_chapter', { selected_school_id: pending.schoolId })
    : client.rpc('join_chapter_by_school', { selected_school_id: pending.schoolId });
  const { error } = await request;
  if (!error) localStorage.removeItem('fi_pending_onboarding');
  else sessionStorage.setItem('fi_onboarding_error', error.message);
}

function initializeHub() {
  const requested = new URLSearchParams(location.search).get('mode') || 'student';
  const form = $('.auth-form'); setSchoolPicker(form);
  $('.hub-intro p:last-child').textContent = 'A teacher creates the chapter for a school. Students create their own accounts and select that same school. At one confirmed teacher and ten confirmed students, the chapter automatically becomes official.';
  $('[name="school-search"]', form).placeholder = 'Try “Westside Houston” or your school and city';
  const loginButton = document.createElement('button');
  loginButton.type = 'button'; loginButton.dataset.authMode = 'login'; loginButton.textContent = 'Sign in';
  $('.auth-switch').append(loginButton);
  const setMode = (mode) => {
    document.body.dataset.authMode = mode;
    document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
    $('.hub-mode-title').textContent = mode === 'teacher' ? 'Start a chapter' : mode === 'login' ? 'Welcome back' : 'Join your chapter';
    $('.hub-mode-description').textContent = mode === 'teacher' ? 'Create the First Invention chapter for your school. Students who choose the same school automatically join your class after confirming their email.' : mode === 'login' ? 'Sign in to your First Invention learning hub.' : 'Create your own account, choose your school, and automatically join its First Invention chapter.';
    $('.chapter-name-field').hidden = true; $('.join-code-field').hidden = true;
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
    showStatus('Creating your account…', 'info', status);
    const redirect = `${location.origin}${location.pathname.replace('hub.html', 'dashboard.html')}`;
    const { data, error } = await client.auth.signUp({ email: values.email, password: values.password, options: { emailRedirectTo: redirect, data: { first_name: values.first_name, last_name: values.last_name } } });
    if (error) return showStatus(error.message, 'error', status);
    localStorage.setItem('fi_pending_onboarding', JSON.stringify({ mode, schoolId: values['school-id'] }));
    if (data.session) { await finishOnboarding(); location.href = 'dashboard.html'; }
    else showStatus('Check your email to confirm your account. Return through that link to finish joining your chapter.', 'success', status);
  });
}

function renderNoChapter() { $('.dashboard-content').innerHTML = '<section class="empty-state"><div class="empty-icon">⚙</div><p class="eyebrow">Your account is ready</p><h1>Your school chapter is not active yet.</h1><p>Ask a teacher or advisor at your school to create the First Invention chapter. Once they do, sign in again and you will join automatically.</p><a class="button" href="hub.html?mode=teacher">I am a teacher or advisor</a></section>'; }

function lessonRows(lessons) {
  return (lessons || []).slice(0, 4).map((lesson) => `<a href="program.html" class="module-row"><span class="module-number">${String(lesson.number).padStart(2, '0')}</span><span><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.unit || 'First Invention curriculum')}</small></span><span class="row-arrow">→</span></a>`).join('') || '<div class="locked-state"><span>🔒</span><div><strong>Your class content is being prepared.</strong><p>Lesson slides, videos, build guides, and quizzes will appear here as your chapter receives them.</p></div></div>';
}

function shellHeader(chapter, official, label) {
  return `<section class="course-banner"><div class="course-mark"><span>FI</span></div><div><p>${official ? 'Official First Invention chapter' : 'Forming First Invention chapter'}</p><h1>${escapeHtml(chapter.name)}</h1><span class="course-school">${escapeHtml(chapter.schools?.name || '')}</span></div><div class="course-banner-actions"><span class="chapter-status ${official ? 'official' : ''}">${official ? '● Official chapter' : '● Building chapter'}</span><button class="icon-button" type="button" aria-label="More ${label} options">•••</button></div></section>`;
}

function studentDashboard(chapter, official, lessons, notes) {
  $('.dashboard-content').innerHTML = `${shellHeader(chapter, official, 'student')}
    ${(notes || []).map((note) => `<div class="notice success"><strong>First Invention update</strong><br>${escapeHtml(note.message)}</div>`).join('')}
    <div class="dashboard-columns">
      <section class="main-column">
        <article class="continue-card"><div><p class="eyebrow">Continue learning</p><h2>${lessons?.[0] ? escapeHtml(lessons[0].title) : 'Your first lesson is coming soon'}</h2><p>${lessons?.[0] ? 'Open your current lesson, follow the build activity, and complete the exit ticket.' : 'Your teacher will open the first lesson once your chapter is ready.'}</p><a class="button" href="program.html">${lessons?.[0] ? 'Open lesson' : 'Explore the program'}</a></div><div class="continue-illustration">⚡</div></article>
        <article class="panel-card"><div class="panel-heading"><div><p class="eyebrow">Course modules</p><h2>Your invention pathway</h2></div><a href="program.html">View all</a></div><div class="module-list">${lessonRows(lessons)}</div></article>
        <article class="panel-card"><div class="panel-heading"><div><p class="eyebrow">Project space</p><h2>Team invention work</h2></div></div><div class="project-grid"><div><span class="project-icon">✎</span><strong>Design journal</strong><small>Capture sketches, tests, and decisions.</small></div><div><span class="project-icon">⌁</span><strong>Build evidence</strong><small>Organize prototype photos and videos.</small></div><div><span class="project-icon">◉</span><strong>Competition plan</strong><small>Find opportunities that fit your project.</small></div></div></article>
      </section>
      <aside class="right-column"><article class="side-card"><p class="eyebrow">Your progress</p><div class="progress-ring"><strong>0%</strong><span>course complete</span></div><p class="quiet">Progress begins when your teacher opens the first lesson.</p></article><article class="side-card"><p class="eyebrow">Coming up</p><h3>Chapter meeting</h3><p>Check with your chapter teacher for the current meeting time and room.</p><a href="program.html">View lesson plan</a></article><article class="side-card accent"><p class="eyebrow">Need guidance?</p><h3>Mentor Exchange</h3><p>Get connected to a professional mentor when your chapter is ready.</p><a href="advisors.html">Explore mentorship →</a></article></aside>
    </div>`;
}

async function teacherDashboard(chapter, official, lessons, notes, count) {
  $('.dashboard-content').innerHTML = `${shellHeader(chapter, official, 'teacher')}
    ${(notes || []).map((note) => `<div class="notice success"><strong>First Invention update</strong><br>${escapeHtml(note.message)}</div>`).join('')}
    <div class="teacher-actions"><a class="primary-action" href="program.html"><span>＋</span> Open a lesson</a><a href="program.html">Review curriculum</a><a href="competitions.html">Competition pathways</a><button class="text-button" type="button">Post announcement</button></div>
    <div class="teacher-stats"><article><span class="stat-icon blue">♟</span><div><strong>${count || 0}<small> / 10</small></strong><span>Confirmed students</span></div></article><article><span class="stat-icon gold">✓</span><div><strong>${official ? 'Official' : 'Forming'}</strong><span>Chapter status</span></div></article><article><span class="stat-icon green">▣</span><div><strong>${lessons?.length || 0}<small> / 30</small></strong><span>Published lessons</span></div></article></div>
    <div class="dashboard-columns teacher-layout"><section class="main-column"><article class="panel-card"><div class="panel-heading"><div><p class="eyebrow">Classroom</p><h2>Current lesson sequence</h2></div><a href="program.html">Manage lessons</a></div><div class="module-list">${lessonRows(lessons)}</div></article><article class="panel-card"><div class="panel-heading"><div><p class="eyebrow">Chapter communication</p><h2>Announcements</h2></div><button class="text-button" type="button">Create</button></div><div class="announcement-empty"><span>📣</span><div><strong>No announcements yet</strong><p>Use announcements for meeting reminders, build deadlines, and chapter updates.</p></div></div></article></section><aside class="right-column"><article class="side-card"><p class="eyebrow">Chapter activation</p><h3>${official ? 'Your chapter is official' : `${count || 0} of 10 students joined`}</h3><div class="activation-bar"><span style="width:${Math.min(100, ((count || 0) / 10) * 100)}%"></span></div><p>${official ? 'Review the kit-dispatch notification in your chapter updates.' : 'Students create individual accounts and select this school to join automatically.'}</p></article><article class="side-card"><p class="eyebrow">At a glance</p><ul class="teacher-checklist"><li>✓ Adult teacher account confirmed</li><li class="${(count || 0) >= 10 ? 'done' : ''}">${(count || 0) >= 10 ? '✓' : '○'} Ten student accounts confirmed</li><li>○ First lesson opened</li><li>○ Chapter kit reviewed</li></ul></article><article class="side-card accent"><p class="eyebrow">Quick resources</p><a href="program.html">30-lesson curriculum</a><a href="teaching-fellows.html">Teaching Fellow materials</a><a href="competitions.html">Competition calendar</a></article></aside></div>`;
}

async function renderChapter(membership) {
  const chapter = membership.chapters, { data: userData } = await client.auth.getUser();
  const [{ data: notes }, { data: lessons }] = await Promise.all([
    client.from('member_notifications').select('message,created_at').eq('user_id', userData.user.id).order('created_at', { ascending: false }).limit(3),
    client.from('lessons').select('number,title,unit').eq('published', true).order('number')
  ]);
  const official = chapter.status === 'official';
  if (membership.member_role === 'teacher') {
    const { count } = await client.from('chapter_members').select('*', { count: 'exact', head: true }).eq('chapter_id', chapter.id).eq('member_role', 'student');
    return teacherDashboard(chapter, official, lessons, notes, count);
  }
  studentDashboard(chapter, official, lessons, notes);
}

async function renderAdmin() {
  const [{ data: chapters }, { data: notes }] = await Promise.all([
    client.from('chapters').select('name,status,schools(name)').order('created_at', { ascending: false }), client.from('chapter_notifications').select('message,created_at').order('created_at', { ascending: false }).limit(20)
  ]);
  $('.dashboard-content').innerHTML = `<section class="dashboard-card"><p class="eyebrow">Administrator view</p><h2>Chapter activation queue</h2><p>Official chapters appear here for chapter-kit review.</p><div class="lesson-list">${(chapters || []).map((chapter) => `<div class="lesson-row"><span class="status-dot ${chapter.status}"></span><strong>${escapeHtml(chapter.name)}</strong><small>${escapeHtml(chapter.schools?.name || '')} · ${escapeHtml(chapter.status)}</small></div>`).join('') || '<p class="quiet">No chapters have been created yet.</p>'}</div></section><section class="dashboard-card"><p class="eyebrow">Notifications</p><h2>Activation notices</h2>${(notes || []).map((note) => `<div class="notice"><strong>${escapeHtml(note.message)}</strong><br><small>${new Date(note.created_at).toLocaleString()}</small></div>`).join('') || '<p class="quiet">No activation notices yet.</p>'}</section>`;
}

function renderNavigation(role) {
  const sidebar = $('.dashboard-sidebar');
  if (!sidebar) return;
  const links = role === 'teacher'
    ? [['Overview', 'dashboard.html'], ['Lessons', 'program.html'], ['Students', 'dashboard.html#students'], ['Announcements', 'dashboard.html#announcements'], ['Chapter resources', 'teaching-fellows.html'], ['Competition pathways', 'competitions.html']]
    : [['Home', 'dashboard.html'], ['Modules', 'program.html'], ['My progress', 'dashboard.html#progress'], ['Team invention work', 'dashboard.html#project'], ['Competition pathways', 'competitions.html'], ['Mentor Exchange', 'advisors.html']];
  sidebar.innerHTML = `<p class="eyebrow">${role === 'teacher' ? 'Teacher course tools' : 'Student learning space'}</p>${links.map(([label, href], index) => `<a class="${index === 0 ? 'active' : ''}" href="${href}">${label}</a>`).join('')}`;
}

async function initializeDashboard() {
  const { data: { session } } = await client.auth.getSession(); if (!session) { location.replace('hub.html'); return; }
  await finishOnboarding();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    client.from('profiles').select('first_name,role').eq('id', session.user.id).single(), client.from('chapter_members').select('chapter_id,member_role,chapters(id,name,join_code,status,schools(name))').eq('user_id', session.user.id).maybeSingle()
  ]);
  $('.dashboard-name').textContent = profile?.first_name ? `${profile.first_name}'s Hub` : 'My First Invention Hub';
  $('.sign-out').addEventListener('click', async () => { await client.auth.signOut(); location.replace('hub.html'); });
  renderNavigation(profile?.role);
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
