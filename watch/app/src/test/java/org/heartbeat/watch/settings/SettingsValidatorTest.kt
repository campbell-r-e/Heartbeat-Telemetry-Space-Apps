package org.heartbeat.watch.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsValidatorTest {

    private fun check(field: SettingField, value: String) = SettingsValidator.check(field, value)

    private fun saved(field: SettingField, value: String) = (check(field, value) as Checked.Valid).value

    private fun refused(field: SettingField, value: String) = (check(field, value) as Checked.Invalid).error

    @Test
    fun `host and port are saved as an http address`() {
        assertEquals("http://192.168.2.1:4000", saved(SettingField.SERVER_URL, "192.168.2.1:4000"))
        assertEquals("http://10.0.0.5:4000", saved(SettingField.SERVER_URL, "  10.0.0.5:4000  "))
    }

    @Test
    fun `full http and https addresses are kept`() {
        assertEquals("https://onboard.example/", saved(SettingField.SERVER_URL, "https://onboard.example/"))
        assertEquals("http://192.168.2.1:4000", saved(SettingField.SERVER_URL, "http://192.168.2.1:4000"))
    }

    @Test
    fun `refuses addresses the watch cannot call, with the mockup's message and example`() {
        val error = refused(SettingField.SERVER_URL, "192.168.2.1;4000")

        assertEquals("That isn't a valid address", error.message)
        assertEquals("Use host:port, for example 192.168.2.1:4000", error.hint)
        assertTrue(check(SettingField.SERVER_URL, "ftp://host") is Checked.Invalid)
        assertTrue(check(SettingField.SERVER_URL, "http://") is Checked.Invalid)
        assertTrue(check(SettingField.SERVER_URL, "http://host:4000/?x=1") is Checked.Invalid)
    }

    @Test
    fun `refuses an empty token or one with spaces`() {
        assertTrue(check(SettingField.TOKEN, " ") is Checked.Invalid)
        assertTrue(check(SettingField.TOKEN, "a b") is Checked.Invalid)
        assertEquals("s3cr3t-token", saved(SettingField.TOKEN, " s3cr3t-token "))
    }

    @Test
    fun `astronaut ids are short and plain`() {
        assertEquals("a1", saved(SettingField.ASTRONAUT_ID, "a1"))
        assertEquals(SettingField.ASTRONAUT_ID, refused(SettingField.ASTRONAUT_ID, "a/1").field)
        assertEquals(SettingField.ASTRONAUT_ID, refused(SettingField.ASTRONAUT_ID, "").field)
    }

    @Test
    fun `the token never appears in logs`() {
        val settings = ConnectionSettings("http://h:1", token = "top-secret-value", astronautId = "a1")

        assertFalse(settings.toString().contains("top-secret"))
        assertEquals("••••", TokenMask.mask("top-secret-value"))
        assertEquals("", TokenMask.mask(""))
    }

    @Test
    fun `base url has no trailing slash`() {
        assertEquals("http://h:4000", ConnectionSettings("http://h:4000/", "t", "a1").baseUrl)
    }
}
