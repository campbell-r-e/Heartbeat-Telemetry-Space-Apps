package org.heartbeat.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimePermissionsTest {
    @Test
    fun `Wear OS 6 asks for granular health permissions instead of body sensors`() {
        val permissions = RuntimePermissions.forSdk(36)

        assertTrue("android.permission.health.READ_HEART_RATE" in permissions)
        assertFalse("android.permission.BODY_SENSORS" in permissions)
    }

    @Test
    fun `older watches ask for body sensors`() {
        assertTrue("android.permission.BODY_SENSORS" in RuntimePermissions.forSdk(33))
    }

    @Test
    fun `asks only for permissions not yet granted`() {
        val required = listOf("a", "b", "c")

        assertEquals(listOf("b"), RuntimePermissions.missing(required) { it != "b" })
        assertEquals(emptyList<String>(), RuntimePermissions.missing(required) { true })
    }

    @Test
    fun `the health service needs at least one health permission`() {
        assertTrue(RuntimePermissions.allowHealthService(listOf("android.permission.health.READ_HEART_RATE")))
        assertFalse(RuntimePermissions.allowHealthService(listOf("android.permission.POST_NOTIFICATIONS")))
    }
}
