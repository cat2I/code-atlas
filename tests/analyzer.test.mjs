import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyzer.js';
import { samples } from '../src/samples.js';
const edgeNames = graph => graph.edges.map(e => [graph.nodes.find(n => n.id === e.source).qualified, graph.nodes.find(n => n.id === e.target).qualified]);
test('locomotion: cross-file calls, constructor and annotated receiver', () => {
  const g = analyze(samples.locomotion.files), edges = edgeNames(g);
  assert.equal(g.nodes.length, 10);
  for (const pair of [['RobotController.step', 'Actor.forward'], ['RobotController.step', 'build_observation'], ['control_loop', 'RobotController.step'], ['RobotController.__init__', 'Actor.__init__'], ['send_targets', 'encode_packet']]) assert.ok(edges.some(e => JSON.stringify(e) === JSON.stringify(pair)), `${pair.join(' → ')} missing`);
  assert.equal(g.files.flatMap(f => f.errors).length, 0);
  const inferred = g.edges.find(e => g.nodes.find(n => n.id === e.target).qualified === 'Actor.forward');
  assert.equal(inferred.inferred, true);
});
test('STM32: direct C calls across files, no invented hardware callback edge', () => {
  const g = analyze(samples.stm32.files);
  assert.ok(edgeNames(g).some(([s, t]) => s === 'control_step' && t === 'pid_update'));
  assert.ok(edgeNames(g).some(([s, t]) => s === 'main' && t === 'control_step'));
  const cb = g.nodes.find(n => n.name === 'HAL_TIM_PeriodElapsedCallback');
  assert.equal(cb.callback, true); assert.equal(g.edges.some(e => e.target === cb.id), false);
  assert.equal(g.files.flatMap(f => f.errors).length, 0);
  const step = g.nodes.find(n => n.name === 'control_step'); assert.equal(step.end - step.start + 1, 5);
});
test('C translation-unit static functions do not leak to other files', () => {
  const g = analyze([{ name: 'a.c', content: 'static int helper(void) {return 1;} int alpha(void) {return helper();}' }, { name: 'b.c', content: 'static int helper(void) {return 2;} int beta(void) {return helper();}' }, { name: 'c.c', content: 'int gamma(void) {return helper();}' }]);
  assert.equal(g.edges.length, 2);
  for (const e of g.edges) assert.equal(g.nodes.find(n => n.id === e.source).file, g.nodes.find(n => n.id === e.target).file);
  assert.equal(g.nodes.find(n => n.name === 'gamma').calls[0].target, null);
});
test('Python comments and strings do not invent calls; nested body belongs to nested function', () => {
  const g = analyze([{ name: 'main.py', content: 'def helper():\n    pass\ndef outer():\n    "helper()"\n    # helper()\n    def inner():\n        helper()\n    inner()\n' }]);
  assert.deepEqual(edgeNames(g).sort(), [['outer', 'outer.inner'], ['outer.inner', 'helper']].sort());
});
test('Python distinct instances resolve self methods within their class', () => {
  const g = analyze([{ name: 'main.py', content: 'class A:\n    def step(self):\n        self.read()\n    def read(self):\n        pass\nclass B:\n    def step(self):\n        self.read()\n    def read(self):\n        pass\n' }]);
  assert.deepEqual(edgeNames(g), [['A.step', 'A.read'], ['B.step', 'B.read']]);
});
test('Python import aliases resolve correct module, dynamic receiver stays unknown', () => {
  const g = analyze([{ name: 'pkg/main.py', content: 'from .sensor import read as sample\nimport unrelated as m\ndef run(obj):\n    sample()\n    obj.read()\n    m.read()\n' }, { name: 'pkg/sensor.py', content: 'def read():\n    return 1\n' }]);
  assert.equal(g.edges.length, 1); const run = g.nodes.find(n => n.name === 'run');
  assert.equal(run.calls.filter(c => !c.target).length, 2);
});
test('Python shadowed local or parameter is not falsely linked to global function', () => {
  const g = analyze([{ name: 'main.py', content: 'def read():\n    pass\ndef run(read):\n    read()\n' }]);
  assert.equal(g.edges.length, 0);
});
test('syntax recovery is reported; files, limits and duplicates are validated', () => {
  assert.throws(() => analyze([{ name: 'a.js', content: '' }]));
  assert.throws(() => analyze([{ name: 'a.py', content: '' }, { name: 'a.py', content: '' }]));
  assert.throws(() => analyze([{ name: 'a.py', content: ' '.repeat(500001) }]));
  const g = analyze([{ name: 'broken.py', content: 'def bad(:\n    return 1\n' }]);
  assert.ok(g.files[0].errors.length > 0);
});
test('Python decorators belong to the code block and are listed on the node', () => {
  const g = analyze([{ name: 'policy.py', content: 'import torch\n\nclass Actor:\n    @torch.no_grad()\n    @staticmethod\n    def forward(obs):\n        return obs\n\n@torch.no_grad()\ndef run(obs):\n    return obs\n' }]);
  const forward = g.nodes.find(n => n.name === 'forward'), run = g.nodes.find(n => n.name === 'run');
  assert.deepEqual(forward.decorators, ['torch.no_grad()', 'staticmethod']);
  assert.equal(forward.start, 4);
  assert.ok(forward.code.startsWith('@torch.no_grad()'));
  assert.ok(forward.code.includes('def forward(obs):'));
  assert.equal(forward.signature, 'def forward(obs)');
  assert.deepEqual(run.decorators, ['torch.no_grad()']);
  assert.equal(run.start, 9);
  assert.ok(run.code.startsWith('@torch.no_grad()'));
});
test('self.method resolves through the base chain inside one file', () => {
  const g = analyze([{ name: 'policy.py', content: 'class Base:\n    def scale(self, x):\n        return x\n    def clip(self, x):\n        return x\n\nclass Walk(Base):\n    def clip(self, x):\n        return x\n    def step(self, obs):\n        self.scale(obs)\n        self.clip(obs)\n        self.missing(obs)\n' }]);
  const step = g.nodes.find(n => n.qualified === 'Walk.step');
  const scale = step.calls.find(c => c.name === 'self.scale'), clip = step.calls.find(c => c.name === 'self.clip');
  assert.equal(g.nodes.find(n => n.id === scale.target).qualified, 'Base.scale');
  assert.equal(scale.inheritedFrom, 'Base');
  assert.equal(g.nodes.find(n => n.id === clip.target).qualified, 'Walk.clip');
  assert.equal(clip.inheritedFrom, undefined);
  assert.equal(step.calls.find(c => c.name === 'self.missing').target, null);
  assert.equal(g.edges.find(e => e.target === scale.target).inherited, true);
});
test('base classes come from imports; metaclass keyword is not a base', () => {
  const g = analyze([
    { name: 'pkg/base.py', content: 'class BasePolicy:\n    def reset(self):\n        return 0\n    def forward(self, obs):\n        return obs\n' },
    { name: 'pkg/walk.py', content: 'from abc import ABCMeta\nfrom .base import BasePolicy\n\nclass WalkPolicy(BasePolicy, metaclass=ABCMeta):\n    def forward(self, obs):\n        super().forward(obs)\n        self.reset()\n        return obs\n' }
  ]);
  assert.deepEqual(g.files.find(f => f.name === 'pkg/walk.py').classes, [{ name: 'WalkPolicy', bases: ['BasePolicy'], line: 4 }]);
  const forward = g.nodes.find(n => n.qualified === 'WalkPolicy.forward');
  const sup = forward.calls.find(c => c.name === 'super().forward'), reset = forward.calls.find(c => c.name === 'self.reset');
  assert.equal(g.nodes.find(n => n.id === sup.target).qualified, 'BasePolicy.forward');
  assert.equal(sup.inheritedFrom, 'BasePolicy');
  assert.equal(g.nodes.find(n => n.id === reset.target).qualified, 'BasePolicy.reset');
  assert.equal(forward.calls.some(c => c.name === 'super'), false);
  assert.equal(g.stats.unresolved, 0);
});
test('inherited __init__ and a class used as receiver resolve; shadowed class name does not', () => {
  const g = analyze([{ name: 'robot.py', content: 'class Base:\n    def __init__(self):\n        self.ready = 1\n    def norm(self, x):\n        return x\n\nclass Robot(Base):\n    def step(self, x):\n        return x\n\ndef build():\n    robot = Robot()\n    Base.norm(robot, 1)\n    return robot\n\ndef shadow(Robot):\n    Robot.step(1)\n' }]);
  const build = g.nodes.find(n => n.name === 'build');
  const ctor = build.calls.find(c => c.name === 'Robot'), norm = build.calls.find(c => c.name === 'Base.norm');
  assert.equal(g.nodes.find(n => n.id === ctor.target).qualified, 'Base.__init__');
  assert.equal(ctor.inheritedFrom, 'Base');
  assert.equal(g.nodes.find(n => n.id === norm.target).qualified, 'Base.norm');
  assert.equal(norm.inheritedFrom, undefined);
  assert.equal(g.nodes.find(n => n.name === 'shadow').calls.find(c => c.name === 'Robot.step').target, null);
});
test('cyclic base classes terminate and C files keep no inheritance data', () => {
  const g = analyze([
    { name: 'loop.py', content: 'class A(B):\n    def step(self):\n        self.gone()\n\nclass B(A):\n    def run(self):\n        return 1\n' },
    { name: 'motor.c', content: 'static int clamp(int v) { return v; }\nint drive(int v) { return clamp(v); }\n' }
  ]);
  assert.equal(g.nodes.find(n => n.qualified === 'A.step').calls[0].target, null);
  assert.deepEqual(g.nodes.find(n => n.name === 'drive').decorators, []);
  assert.deepEqual(g.nodes.find(n => n.name === 'drive').classBases, []);
  assert.deepEqual(g.files.find(f => f.name === 'motor.c').classes, []);
});
test('unresolved calls split into builtin, external library and genuinely unknown', () => {
  const g = analyze([{ name: 'train.py', content: 'import argparse\nimport torch\nimport numpy as np\n\ndef main(cfg):\n    ap = argparse.ArgumentParser()\n    ap.add_argument("--task")\n    print(len(cfg))\n    torch.zeros(3)\n    np.array([1])\n    cfg.step()\n    helper()\n' }]);
  const calls = Object.fromEntries(g.nodes.find(n => n.name === 'main').calls.map(c => [c.name, c]));
  assert.equal(calls['print'].kind, 'builtin');
  assert.equal(calls['len'].kind, 'builtin');
  assert.equal(calls['torch.zeros'].module, 'torch');
  assert.equal(calls['np.array'].module, 'numpy');
  assert.equal(calls['argparse.ArgumentParser'].module, 'argparse');
  assert.equal(calls['ap.add_argument'].module, 'argparse');
  assert.equal(calls['cfg.step'].kind, 'unknown');
  assert.equal(calls['helper'].kind, 'unknown');
  assert.equal(g.stats.unresolved, 2);
  assert.equal(g.stats.external, 6);
});
test('a symbol re-exported by another module still resolves', () => {
  const g = analyze([
    { name: 'pkg/_shared/lab3.py', content: 'def as_torch(value):\n    return value\n' },
    { name: 'pkg/envs/task.py', content: 'from .._shared.lab3 import as_torch\n\ndef build(x):\n    return as_torch(x)\n' },
    { name: 'scripts/validate.py', content: 'from pkg.envs.task import as_torch\n\ndef main(x):\n    return as_torch(x)\n' }
  ]);
  const target = g.nodes.find(n => n.qualified === 'as_torch');
  for (const caller of ['build', 'main']) {
    const call = g.nodes.find(n => n.name === caller).calls.find(c => c.name === 'as_torch');
    assert.equal(call.target, target.id, `${caller} should reach the real definition`);
  }
  assert.equal(g.stats.unresolved, 0);
});
test('trailing-dot floats parse cleanly and the shown code stays byte-identical', () => {
  const content = 'from sim import SimulationCfg\n\ndef build():\n    """Gravity uses 0. form."""\n    cfg = SimulationCfg(dt=0.005, gravity=(0., 0., -9.81), span=10.)\n    return scale(cfg, 1.)\n\ndef scale(cfg, k):\n    return cfg\n';
  const g = analyze([{ name: 'sim_setup.py', content }]);
  assert.deepEqual(g.files[0].errors, []);
  const build = g.nodes.find(n => n.name === 'build');
  assert.ok(build.code.includes('gravity=(0., 0., -9.81)'), 'code block keeps the original literals');
  assert.equal(build.doc, 'Gravity uses 0. form.');
  assert.equal(build.start, 3);
  assert.equal(g.nodes.find(n => n.id === build.calls.find(c => c.name === 'scale').target).name, 'scale');
});
