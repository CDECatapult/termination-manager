'use strict'

const nodeProcess = require('process') // eslint-disable-line import/no-unresolved

const noop = () => {}

class StopTimeoutError extends Error {
  constructor (task, grace) {
    super('Task took too long to stop')
    this.name = 'StopTimeoutError'

    this.task = task
    this.grace = grace
  }
}

async function invokeStop (task, grace) {
  return Promise.race([
    task.stop(grace),

    // Reject with a timeout error if it takes 10% longer than the grace period
    // to stop the task. Default to 100ms in case grace === 0.
    new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new StopTimeoutError(task, grace))
      }, Math.max(100, grace * 1.1)).unref()
    })
  ])
}

async function chain (from, tasks, grace) {
  await from.promise
  await Promise.all(tasks.map(task => invokeStop(task, grace)))
}

class TerminationManager {
  constructor ({
    grace = 5000,
    drainGrace = 5000,
    onDrainTimeout = noop,
    onSigint = noop,
    onSigterm = noop,
    onStopError = noop,
    onUncaughtException = noop,
    onUnhandledRejection = noop
  } = {}) {
    this.grace = grace
    this.drainGrace = drainGrace
    this.onDrainTimeout = onDrainTimeout
    this.onStopError = onStopError

    this.exiting = false
    this.tasks = []

    nodeProcess.on('SIGINT', () => {
      onSigint()
      this.exit()
    })

    nodeProcess.on('SIGTERM', () => {
      onSigterm()
      this.exit()
    })

    nodeProcess.on('uncaughtException', err => {
      onUncaughtException(err)
      this.crash()
    })

    nodeProcess.on('unhandledRejection', err => {
      onUnhandledRejection(err)
      this.crash()
    })
  }

  add ({name, priority = 0, stop}) {
    if (typeof name !== 'string' || name === '') throw new TypeError('Expected `name` to be a non-empty string')
    if (!Number.isInteger(priority) || priority < 0) throw new TypeError('Expected `priority` to be an integer >= 0')
    if (typeof stop !== 'function') throw new TypeError('Expected `stop` to be a function')

    this.tasks.push({name, priority, stop})
    return this
  }

  crash () {
    this.exit({code: 1, grace: 0})
  }

  exit ({code = 0, grace = this.grace} = {}) {
    // Don't overwrite previous exit codes, unless it's 0.
    if (!nodeProcess.exitCode) nodeProcess.exitCode = code

    // Don't exit twice
    if (this.exiting) return
    this.exiting = true

    const {promise} = this.tasks
      // Highest priority is stopped first.
      .sort((a, b) => b.priority - a.priority)
      .reduce((seq, {name, priority, stop}) => {
        const task = {name, stop}
        if (priority === seq.priority) {
          seq.tasks.push(task)
          return seq
        }

        const tasks = [task]
        return {
          promise: chain(seq, tasks, grace),
          priority,
          tasks
        }
      }, {promise: Promise.resolve(), priority: -1, tasks: []})

    promise.catch(err => {
      this.onStopError(err)
      if (!nodeProcess.exitCode) nodeProcess.exitCode = 1
    })

    // Allow the event loop to drain, but don't wait more than the configured
    // grace period.
    setTimeout(() => {
      this.onDrainTimeout()
      setImmediate(() => nodeProcess.exit()) // eslint-disable-line unicorn/no-process-exit
    }, this.drainGrace).unref()
  }
}
module.exports = TerminationManager
