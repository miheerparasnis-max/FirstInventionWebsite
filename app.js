document.querySelectorAll('[data-placeholder-form]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = form.querySelector('.form-status');
    status.textContent = 'This is a placeholder form. It does not collect or send information yet.';
  });
});
