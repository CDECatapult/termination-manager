import {setImmediate as nodeSetImmediate, setTimeout as nodeSetTimeout} from 'timers'
import test from 'ava'
import lolex from 'lolex'
import proxyquire from 'proxyquire'
import td from 'testdouble'

const realTimeout = setTimeout

// All tests share the same clock. Tests using async-await should be run
// serially to make sure they don't affect each other.
const clock = lolex.install({now: 0})
// Force the seriality by running all remaining timers after each test finishes.
test.always.afterEach(() => clock.runAll())

test.beforeEach(t => {
  const processStub = td.object({
    on (evt, cb) {},
    exit (code) {}
  })
  const TerminationManager = proxyquire('.', {
    process: processStub
  })

  t.context = {
    instantiate: (options = {}) => new TerminationManager(options),
    process: processStub,
    TerminationManager
  }
})

test('options are optional', t => {
  const manager = new t.context.TerminationManager()
  t.truthy(manager) // Here for code coverage
})

test.cb('calls onSigint', t => {
  td.when(t.context.process.on('SIGINT'), {defer: true}).thenCallback()
  t.context.instantiate({
    onSigint: t.end
  })
  clock.runAll()
})

test.cb('calls onSigterm', t => {
  td.when(t.context.process.on('SIGTERM'), {defer: true}).thenCallback()
  t.context.instantiate({
    onSigterm: t.end
  })
  clock.runAll()
})

test.cb('calls onUncaughtException', t => {
  const expected = new Error()
  td.when(t.context.process.on('uncaughtException'), {defer: true}).thenCallback(expected)
  t.context.instantiate({
    onUncaughtException (actual) {
      t.is(actual, expected)
      t.end()
    }
  })
  clock.runAll()
})

test.cb('calls onUnhandledRejection', t => {
  const expected = new Error()
  td.when(t.context.process.on('unhandledRejection'), {defer: true}).thenCallback(expected)
  t.context.instantiate({
    onUnhandledRejection (actual) {
      t.is(actual, expected)
      t.end()
    }
  })
  clock.runAll()
})

test.cb('exits gracefully on SIGINT', t => {
  t.plan(2)
  td.when(t.context.process.on('SIGINT'), {delay: 5}).thenCallback()
  t.context.instantiate({grace: 1}).add({
    name: 'grace-spy',
    stop (grace) {
      t.is(grace, 1)
      t.end()
    }
  })
  clock.runAll()
  t.is(t.context.process.exitCode, 0)
})

test.cb('exits gracefully on SIGTERM', t => {
  t.plan(2)
  td.when(t.context.process.on('SIGTERM'), {defer: true}).thenCallback()
  t.context.instantiate({grace: 1}).add({
    name: 'grace-spy',
    stop (grace) {
      t.is(grace, 1)
      t.end()
    }
  })
  clock.runAll()
  t.is(t.context.process.exitCode, 0)
})

test.cb('crashes on uncaughtException', t => {
  t.plan(2)
  td.when(t.context.process.on('uncaughtException'), {defer: true}).thenCallback(new Error())
  t.context.instantiate({grace: 1}).add({
    name: 'grace-spy',
    stop (grace) {
      t.is(grace, 0)
      t.end()
    }
  })
  clock.runAll()
  t.is(t.context.process.exitCode, 1)
})

test.cb('crashes on unhandledRejection', t => {
  t.plan(2)
  td.when(t.context.process.on('unhandledRejection'), {defer: true}).thenCallback(new Error())
  t.context.instantiate({grace: 1}).add({
    name: 'grace-spy',
    stop (grace) {
      t.is(grace, 0)
      t.end()
    }
  })
  clock.runAll()
  t.is(t.context.process.exitCode, 1)
})

const addTypeCheck = (t, key, value) => {
  const manager = t.context.instantiate()
  const task = {name: 'test', priority: 42, stop () {}, [key]: value}
  t.throws(() => manager.add(task), TypeError)
}
addTypeCheck.title = (condition, key) => `add() requires ${key} to be ${condition}`
test('a string', addTypeCheck, 'name', true)
test('a non-empty string', addTypeCheck, 'name', '')
test('an integer', addTypeCheck, 'priority', Math.PI)
test('a nonnegative integer', addTypeCheck, 'priority', -1)
test('a function', addTypeCheck, 'stop', {})

test('add() returns the instance', t => {
  const instance = t.context.instantiate()
  t.is(instance, instance.add({name: 'foo', stop () {}}))
})

test('crash() exits', async t => {
  t.plan(2)
  await t.context.instantiate({grace: 1}).add({
    name: 'grace-spy',
    stop (grace) {
      t.is(grace, 0)
    }
  }).crash()
  t.is(t.context.process.exitCode, 1)
})

test('exit() exits gracefully', async t => {
  t.plan(2)
  await t.context.instantiate({grace: 1}).add({
    name: 'grace-spy',
    stop (grace) {
      t.is(grace, 1)
    }
  }).exit()
  t.is(t.context.process.exitCode, 0)
})

test.cb('tasks are ordered correctly', t => {
  const order = []
  const instance = t.context.instantiate()
  instance.add({name: '90-0', priority: 90, stop () { order.push('90-0') }})
  instance.add({name: '100-0', priority: 100, stop () { order.push('100-0') }})
  instance.add({
    name: '10-0',
    priority: 10,
    stop () {
      order.push('10-0')
      t.deepEqual(order, ['100-0', '90-0', '90-1', '10-0'])
      t.end()
    }
  })
  instance.add({name: '90-1', priority: 90, stop () { order.push('90-1') }})
  instance.exit()
})

test.serial.cb('all tasks of a priority complete before the next are run', t => {
  const order = []
  let resolveFirst
  const firstPromise = new Promise(resolve => {
    resolveFirst = resolve
  })

  t.plan(4)
  const instance = t.context.instantiate()
  instance.add({name: '90-0',
    priority: 90,
    async stop () {
      t.deepEqual(order, ['100-0'])
      order.push('90-0')
      await firstPromise
    }
  })
  instance.add({name: '100-0',
    priority: 100,
    stop () {
      t.deepEqual(order, [])
      order.push('100-0')
    }
  })
  instance.add({name: '10-0',
    priority: 10,
    stop () {
      t.deepEqual(order, ['100-0', '90-0', '90-1'])
      t.end()
    }
  })
  instance.add({name: '90-1',
    priority: 90,
    stop () {
      t.deepEqual(order, ['100-0', '90-0'])
      order.push('90-1')
      realTimeout(resolveFirst, 10)
    }
  })
  instance.exit()
})

test.cb('calls onStopError when a task fails', t => {
  const expected = new Error()
  t.context.instantiate({
    onStopError (actual) {
      t.is(actual, expected)
      t.end()
    }
  }).add({
    name: 'throws',
    stop () { throw expected }
  }).exit()
})

test.serial.cb('calls onStopError when a task times out', t => {
  const name = 'timer-out'
  const stop = async () => {
    await Promise.resolve()
    clock.runAll()
    return new Promise(() => {})
  }

  t.context.instantiate({
    grace: 42,
    onStopError (err) {
      t.is(err.name, 'StopTimeoutError')
      t.is(err.grace, 42)
      t.deepEqual(err.task, {name, stop})
      t.end()
    }
  }).add({name, stop}).exit()
})

test.serial.cb('a task times out after 110% of the grace period has passed', t => {
  t.plan(1)

  t.context.instantiate({
    grace: 100,
    onStopError () {
      t.end()
    }
  }).add({
    name: 'timer-out',
    async stop () {
      await Promise.resolve()
      clock.tick(109)
      realTimeout(() => {
        t.pass()
        clock.tick(1)
      })
      return new Promise(() => {})
    }
  }).exit()
})

test.serial.cb('exit() sets exitCode when a task times out', t => {
  const name = 'timer-out'
  const stop = async () => {
    await Promise.resolve()
    clock.runAll()
    return new Promise(() => {})
  }

  t.context.instantiate().add({name, stop}).exit()
  nodeSetImmediate(() => {
    t.is(t.context.process.exitCode, 1)
    t.end()
  })
})

test.serial('exit() sets exitCode when a task times out, unless already set and nonzero', async t => {
  const name = 'timer-out'
  const stop = async () => {
    await Promise.resolve()
    clock.runAll()
    return new Promise(() => {})
  }

  await t.context.instantiate().add({name, stop}).exit({code: 2})
  t.is(t.context.process.exitCode, 2)
})

test('exit({code}) only overrides nonzero exit codes', t => {
  const instance = t.context.instantiate()
  instance.exit()
  t.is(t.context.process.exitCode, 0)
  instance.exit({code: 1})
  t.is(t.context.process.exitCode, 1)
  instance.exit({code: 2})
  t.is(t.context.process.exitCode, 1)
})

test.cb('exit() only runs tasks once', t => {
  t.plan(1)
  const instance = t.context.instantiate().add({name: 'task', stop () { t.pass() }})
  instance.exit()
  instance.exit()

  nodeSetTimeout(t.end, 100)
})

test.serial('calls onDrainTimeout when the process fails to exit', async t => {
  let called = false
  t.context.instantiate({
    onDrainTimeout () {
      called = true
    }
  }).exit()

  await Promise.resolve()
  t.false(called)
  t.is(td.explain(t.context.process.exit).callCount, 0)

  clock.runAll()
  t.true(called)
  t.is(td.explain(t.context.process.exit).callCount, 1)
})

test('grace defaults to 5 seconds', async t => {
  await t.context.instantiate().add({
    name: 'check-default',
    stop (grace) {
      t.is(grace, 5000)
    }
  }).exit()
})

test.serial('drainGrace defaults to 5 seconds', async t => {
  t.context.instantiate().exit()

  await Promise.resolve()
  t.is(td.explain(t.context.process.exit).callCount, 0)

  clock.tick(4999)
  t.is(td.explain(t.context.process.exit).callCount, 0)

  clock.tick(1)
  clock.next() // process.exit() is called inside a setImmediate()
  t.is(td.explain(t.context.process.exit).callCount, 1)
})
