/**
 * Quiz content stores its questions (including the `correct` answer index)
 * as JSON in `content.body`. Students must never receive the answers —
 * grading happens server-side in quizController. Managers (course creator,
 * faculty, super admin) still get the full body for editing.
 */
function stripQuizAnswers(content) {
  if (!content || content.type !== 'QUIZ' || !content.body) return content;
  try {
    const questions = JSON.parse(content.body);
    if (!Array.isArray(questions)) return content;
    const safe = questions.map(({ correct, ...rest }) => rest);
    return { ...content, body: JSON.stringify(safe) };
  } catch (_) {
    return content;
  }
}

function isCourseManager(user, course) {
  if (!user || !course) return false;
  return course.creatorId === user.id || ['FACULTY', 'SUPER_ADMIN'].includes(user.role);
}

module.exports = { stripQuizAnswers, isCourseManager };
