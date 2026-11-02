export function getQuestionCategories(questions) {
  const counts = new Map()

  for (const question of questions) {
    if (
      !question ||
      typeof question.qid !== 'string' ||
      typeof question.question !== 'string' ||
      question.marks !== 10
    ) {
      continue
    }

    const categories = new Set(
      Array.isArray(question.categories)
        ? question.categories.filter(
            (category) => typeof category === 'string' && category.trim(),
          )
        : [],
    )
    if (typeof question.topic === 'string' && question.topic.trim()) {
      categories.add(question.topic.trim())
    }

    for (const category of categories) {
      counts.set(category, (counts.get(category) || 0) + 1)
    }
  }

  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function chooseRandomQuestions(questions, category) {
  const eligibleQuestions = questions.filter(
    (question) =>
      question &&
      typeof question.qid === 'string' &&
      typeof question.question === 'string' &&
      question.marks === 10 &&
      (question.topic === category ||
        (Array.isArray(question.categories) &&
          question.categories.includes(category))),
  )

  if (eligibleQuestions.length < 10) {
    return null
  }

  for (let index = eligibleQuestions.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const currentQuestion = eligibleQuestions[index]
    eligibleQuestions[index] = eligibleQuestions[randomIndex]
    eligibleQuestions[randomIndex] = currentQuestion
  }

  return eligibleQuestions.slice(0, 10)
}
