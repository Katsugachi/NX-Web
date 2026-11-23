// SPDX-License-Identifier: GPL-3.0-or-later
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <switch.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <glad/glad.h>

static bool fail(const char* message) {
    svcOutputDebugString(message, strlen(message));
    return false;
}

static GLuint shader(GLenum stage, const char* source) {
    GLuint result = glCreateShader(stage);
    glShaderSource(result, 1, &source, NULL);
    glCompileShader(result);
    GLint ok = GL_FALSE;
    glGetShaderiv(result, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024] = {0};
        glGetShaderInfoLog(result, sizeof(log), NULL, log);
        fail("GL_INSTANCING failure: shader compilation");
        fail(log);
        glDeleteShader(result);
        return 0;
    }
    return result;
}

static GLuint program(const char* vertex, const char* fragment) {
    GLuint vs = shader(GL_VERTEX_SHADER, vertex), fs = shader(GL_FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return 0;
    GLuint result = glCreateProgram();
    glAttachShader(result, vs);
    glAttachShader(result, fs);
    glLinkProgram(result);
    glDeleteShader(vs);
    glDeleteShader(fs);
    GLint ok = GL_FALSE;
    glGetProgramiv(result, GL_LINK_STATUS, &ok);
    if (!ok) {
        fail("GL_INSTANCING failure: program link");
        glDeleteProgram(result);
        return 0;
    }
    return result;
}

static bool framebuffer(GLuint* fbo, GLuint* texture, int width, int height) {
    glGenTextures(1, texture);
    glBindTexture(GL_TEXTURE_2D, *texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, *fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, *texture, 0);
    return glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
}

int main(void) {
    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (!eglInitialize(display, NULL, NULL) || !eglBindAPI(EGL_OPENGL_API)) {
        fail("GL_INSTANCING failure: EGL initialization");
        return 1;
    }
    const EGLint attributes[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
    EGLConfig config;
    EGLint count = 0;
    if (!eglChooseConfig(display, attributes, &config, 1, &count) || count != 1) {
        fail("GL_INSTANCING failure: EGL config");
        return 1;
    }
    const EGLint context_attributes[] = {EGL_CONTEXT_OPENGL_PROFILE_MASK_KHR,
        EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT_KHR, EGL_CONTEXT_MAJOR_VERSION_KHR, 4,
        EGL_CONTEXT_MINOR_VERSION_KHR, 3, EGL_NONE};
    EGLSurface surface = eglCreateWindowSurface(display, config, nwindowGetDefault(), NULL);
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, context_attributes);
    if (surface == EGL_NO_SURFACE || context == EGL_NO_CONTEXT ||
        !eglMakeCurrent(display, surface, surface, context) || !gladLoadGL()) {
        fail("GL_INSTANCING failure: GL context");
        return 1;
    }
    const char* vertex = "#version 430 core\n"
        "layout(location=0) in vec2 corner;layout(location=1) in float instance_x;"
        "uniform float row;out vec3 color;"
        "void main(){color=gl_InstanceID==0?vec3(1,0,0):"
        "gl_InstanceID==1?vec3(0,1,0):vec3(0,0,1);"
        "gl_Position=vec4(instance_x+corner.x*.15,row+corner.y*.15,0,1);}";
    const char* fragment = "#version 430 core\nin vec3 color;out vec4 pixel;"
        "void main(){pixel=vec4(color,1);}";
    const char* copy_vertex = "#version 430 core\nlayout(location=0) in vec2 corner;out vec2 uv;"
        "void main(){uv=corner*.5+.5;gl_Position=vec4(corner,0,1);}";
    const char* copy_fragment = "#version 430 core\nin vec2 uv;uniform sampler2D image;out vec4 pixel;"
        "void main(){pixel=texture(image,uv);}";
    GLuint sprites = program(vertex, fragment), copy = program(copy_vertex, copy_fragment);
    if (!sprites || !copy) return 1;
    const float corners[] = {-1,-1, 1,-1, -1,1, 1,1};
    const float positions[] = {-.75f,-.25f,.25f,.75f};
    const GLushort indices[] = {0,1,2,3};
    GLuint vao, buffers[3];
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    glGenBuffers(3, buffers);
    glBindBuffer(GL_ARRAY_BUFFER, buffers[0]);
    glBufferData(GL_ARRAY_BUFFER, sizeof(corners), corners, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), NULL);
    glEnableVertexAttribArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, buffers[1]);
    glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);
    glVertexAttribPointer(1, 1, GL_FLOAT, GL_FALSE, sizeof(float), NULL);
    glEnableVertexAttribArray(1);
    glVertexAttribDivisor(1, 1);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffers[2]);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STATIC_DRAW);
    GLuint fbos[2], textures[2];
    if (!framebuffer(&fbos[0], &textures[0], 1280, 720) ||
        !framebuffer(&fbos[1], &textures[1], 320, 180)) {
        fail("GL_INSTANCING failure: framebuffer incomplete");
        return 1;
    }
    glClearColor(0, 0, 0, 1);
    bool reported = false;
    while (appletMainLoop()) {
        glBindFramebuffer(GL_FRAMEBUFFER, fbos[0]);
        glViewport(0, 0, 1280, 720);
        glClear(GL_COLOR_BUFFER_BIT);
        glUseProgram(sprites);
        GLint row = glGetUniformLocation(sprites, "row");
        glUniform1f(row, .6f);
        glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, 3);
        glUniform1f(row, 0);
        glDrawArraysInstancedBaseInstance(GL_TRIANGLE_STRIP, 0, 4, 3, 1);
        glUniform1f(row, -.6f);
        glDrawElementsInstanced(GL_TRIANGLE_STRIP, 4, GL_UNSIGNED_SHORT, NULL, 3);
        glUniform1f(row, .95f);
        glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, 0);
        glBindFramebuffer(GL_FRAMEBUFFER, fbos[1]);
        glViewport(0, 0, 320, 180);
        glClear(GL_COLOR_BUFFER_BIT);
        glUseProgram(copy);
        glBindTexture(GL_TEXTURE_2D, textures[0]);
        glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, 1280, 720);
        glBindTexture(GL_TEXTURE_2D, textures[1]);
        glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        if (glGetError() != GL_NO_ERROR) {
            fail("GL_INSTANCING failure: GL error");
            return 1;
        }
        eglSwapBuffers(display, surface);
        if (!reported) {
            const char* ready = "GL_INSTANCING ready errors=0";
            svcOutputDebugString(ready, strlen(ready));
            reported = true;
        }
    }
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, context);
    eglDestroySurface(display, surface);
    eglTerminate(display);
    return 0;
}
