export const samples = {
  locomotion: {
    title: 'Locomotion · policy → actuator',
    description: 'Python · Raspberry Pi · policy inference',
    files: [{ name: 'robot/controller.py', content: `"""Example only: a locomotion inference loop, not hardware-ready code."""
from policy import Actor
from observations import build_observation
from transport import send_targets

class RobotController:
    """Turn robot state into joint targets."""

    def __init__(self, model_path):
        self.policy = Actor(model_path)
        self.previous_action = [0.0] * 12

    def step(self, imu, joints, command):
        """One policy step: observe, infer, scale, transmit."""
        obs = build_observation(imu, joints, command,
                                self.previous_action)
        action = self.policy.forward(obs)
        targets = self.scale_action(action)
        send_targets(targets)
        self.previous_action = action
        return targets

    def scale_action(self, action):
        """Map normalized policy actions to joint offsets."""
        action_scale = 0.25
        return [max(-1.0, min(1.0, a)) * action_scale
                for a in action]

def control_loop(robot: RobotController, sensors):
    """Illustrative loop; timing and safety are omitted."""
    while sensors.ready():
        imu, joints = sensors.read()
        robot.step(imu, joints, command=[0.2, 0.0, 0.0])
` }, { name: 'robot/policy.py', content: `import numpy as np
import onnxruntime as ort

class Actor:
    """Run an exported locomotion policy."""

    def __init__(self, model_path):
        self.session = ort.InferenceSession(model_path)

    def forward(self, observation):
        """observation → float32 tensor → joint actions."""
        tensor = np.asarray(observation, dtype=np.float32)
        outputs = self.session.run(None, {"obs": tensor[None]})
        return outputs[0][0].tolist()
` }, { name: 'robot/observations.py', content: `def normalize(values, scale):
    return [v * scale for v in values]

def build_observation(imu, joints, command, previous_action):
    """Pack angular velocity, joints, command, last action."""
    angular_velocity = normalize(imu.gyro, 0.25)
    joint_velocity = normalize(joints.velocity, 0.05)
    return (angular_velocity + joints.position
            + joint_velocity + command + previous_action)
` }, { name: 'robot/transport.py', content: `import struct

def encode_packet(targets):
    """Example binary frame shared with the STM32 firmware."""
    return b"AT" + struct.pack("<12f", *targets)

def send_targets(targets):
    """Encode a target packet. Serial writing is left to the caller."""
    packet = encode_packet(targets)
    return packet
` }]
  },
  stm32: {
    title: 'STM32 · timer → PID → PWM',
    description: 'C · HAL callbacks · vòng điều khiển',
    files: [{ name: 'Core/Src/main.c', content: `/* Illustrative firmware structure, not deployable motor firmware. */
#include "main.h"
#include "control.h"

extern TIM_HandleTypeDef htim2;
extern UART_HandleTypeDef huart2;
volatile uint8_t control_due = 0;
uint8_t rx_byte;

int main(void) {
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();
    MX_TIM2_Init();
    MX_USART2_UART_Init();
    control_init();
    HAL_TIM_Base_Start_IT(&htim2);
    HAL_UART_Receive_IT(&huart2, &rx_byte, 1);
    while (1) {
        if (control_due) {
            control_due = 0;
            control_step();
        }
    }
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    /* Hardware invokes this through HAL; main does not call it. */
    if (htim->Instance == TIM2) {
        control_due = 1;
    }
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART2) {
        parse_command(rx_byte);
        HAL_UART_Receive_IT(huart, &rx_byte, 1);
    }
}
` }, { name: 'Core/Src/control.c', content: `#include "control.h"
#include "motor.h"

static float target = 0.0f;
static float integral = 0.0f;

void control_init(void) {
    integral = 0.0f;
    motor_init();
}

float pid_update(float setpoint, float measured) {
    /* Simplified PI example with fixed dt. */
    float error = setpoint - measured;
    integral += error * 0.001f;
    return clamp(2.0f * error + 0.1f * integral, -1.0f, 1.0f);
}

void control_step(void) {
    float position = encoder_read();
    float output = pid_update(target, position);
    motor_set_pwm(output);
}

void parse_command(uint8_t byte) {
    /* Placeholder protocol for exploring call relationships. */
    target = ((float)byte - 128.0f) / 128.0f;
}
` }, { name: 'Core/Src/motor.c', content: `#include "motor.h"

float clamp(float value, float low, float high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
}

void motor_init(void) {
    HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);
}

float encoder_read(void) {
    return (float)__HAL_TIM_GET_COUNTER(&htim4) * 0.001f;
}

void motor_set_pwm(float duty) {
    float limited = clamp(duty, 0.0f, 1.0f);
    __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1,
                          (uint32_t)(limited * 999.0f));
}
` }, { name: 'Core/Inc/control.h', content: `#ifndef CONTROL_H
#define CONTROL_H
#include <stdint.h>
void control_init(void);
void control_step(void);
float pid_update(float setpoint, float measured);
void parse_command(uint8_t byte);
#endif
` }]
  }
};
