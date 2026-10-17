export const SLACK = 4

export function within(label, seconds, work) {
  const limit = seconds * SLACK
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} did not finish within ${Math.ceil(limit)} s (${SLACK}x the ${Math.round(seconds * 10) / 10} s it should take)`), { late: true })), limit * 1000)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export function planned(budget, shotSeconds, contract, seconds) {
  return {
    frames: count => count * budget.hitchMs / 1000,
    shot: count => count * shotSeconds,
    script: name => contract?.model?.scripts?.[name] ?? seconds,
  }
}
