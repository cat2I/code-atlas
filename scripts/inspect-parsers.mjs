import { parser as py } from '@lezer/python';
import { parser as c } from '@lezer/cpp';
console.log('PYTHON', py.parse(`from policy import Actor as Policy\nimport sensors as s\nclass Robot:\n    def __init__(self):\n        self.policy = Policy()\n    def step(self, obs):\n        action = self.policy.forward(obs)\n        s.read_imu()\n        return self.normalize(action)\n    def normalize(self, x):\n        return x\ndef run(robot: Robot):\n    robot.step([])\n`).toString());
console.log('C', c.parse(`#include "motor.h"\ntypedef struct { float kp; } PID;\nstatic float update(float target) { return clamp(target); }\nvoid HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) { if(htim->Instance == TIM2) update(1); }\nint main(void) { HAL_Init(); while(1) { update(0); } }`).toString());
