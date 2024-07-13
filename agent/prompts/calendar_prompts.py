SYSTEM_PROMPT_CALENDAR = (
    'Generate event in json format for google calendar api based on chat history.\n'
    '-------schema------\n'
    '{{"action": "<insert or update or delete>","event": {{"calendarId": "<Id of calendar>", "eventId"?: "<fill if '
    'action is update or delete>", "requestBody": {{"summary":"<title of event>", "description": "<description and '
    'details of event>", "start": {{"date": "<date>", "dateTime": "<RFC3339 dateTime, use timezone of calendar, dont change time>", "timeZone"?: "IANA timeZone of '
    'event"}}, "end": {{"date": "<date>", "dateTime": "<RFC3339 dateTime, use timezone of calendar, dont change time>", "timeZone"?: "IANA timeZone of event"}}}}}}, '
    '"telegramUsernames": [<list of usernames of telegram participants>], "message": "<describe generated event to '
    'return user, use a language of a command for answer>"}}\n'
    '-------------------'
)

USER_PROMPT_CALENDAR = (
    "Use information about calendars and existing events for generation event\n"
    "Calendars:\n"
    "-----------\n"
    "{calendars_str}\n"
    "-----------\n\n"
    
    "Events:\n"
    "-----------\n"
    "{events_str}\n"
    "-----------\n\n"
    
    "Context information from multiple sources is below:\n"
    "-----------\n"
    "{context_str}\n"
    "-----------\n\n"
    
    "Latest messages are below.\n"
    "---------------------\n"
    "{messages_str}"
    "---------------------\n"
    "Use latest messages for more relevant generation.\n\n"
        
    "User command:\n\n"
    "{query_str}"
)

