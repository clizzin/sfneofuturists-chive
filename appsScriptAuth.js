/* appsScriptAuth.js
 *
 * This is NOT part of the NYT Library web app! It's a standalone Google Apps Script which can be
 * used to check whether a user is authorized to access a Google Drive folder. By deploying this
 * script, only those who have access to the folder that Library accesses will be able to access
 * Library. (Some organizations can use a common domain to restrict access, but the rest of us
 * need to do it the hard way...)
 * 
 * Theory of operation: When a user logs into Library via Google OAuth (Slack not currently
 * supported for this workflow), PassportJS will run the `serialize` callback to encode the user's
 * login info into their session. When that callback runs, we interject and execute a call to this
 * script (running as a Google Apps Script webapp and accepting GET requests), passing the user's
 * email addresses and expecting an `authorized` parameter in response. That `authorized` flag
 * then gets added to the user's session and is checked on each subsequent page request, instead of
 * the original Library strategy of checking their address against an allow-list on each request.
 * 
 * To deploy this script:
 * 1. Identify or create a "management" account, other than the service account for Library, that
 *    has write access to the Google Drive folder Library uses AND is a member of any groups that
 *    have permission to access that folder.
 * 2. Create a new Google Apps Script project (https://script.google.com/) under the manamegent
 *    account, and paste this source code into it.
 * 3. Change PUT_YOUR_DRIVE_FOLDER_ID_HERE to the DRIVE_ID you use with Library.
 * 4. Test it out with sample user emails from your org, either with the oneOffTest function or
 *    by adding unit tests to the runUnitTests function. Select the function name in the top bar,
 *    then hit Run. You should see console logging output in the bottom panel.
 * 5. Deploy it: Deploy -> New Deployment -> Type: Web App -> Execute as Me -> Anyone has access
 * 6. Note the Web app URL (not the library URL) that comes up when your deployment is confirmed.
 *    Paste that URL into `const authUrl` in custom/userAuth.js in this project.
 * 7. Test the end-to-end flow - you're done!
 * 
 * Note on logging: the Logger.log statements in this code ONLY work when the app is run manually
 * with the Run button. When used as a web app, the log statements go to /dev/null. You'd have to
 * enable Google Cloud Logging to retain them, which I don't feel like doing right now :)
 */

// webapp deployment entry point
// expects a GET request with a parameter "user" which is a single email address or an array of the same
// https://developers.google.com/apps-script/guides/web
function doGet(e) {
  var authorized = false;
  if ('user' in e.parameters) {
    authorized = isUserAuthorizedForChive([e.parameter['user']])
  } else if ('user[]' in e.parameters) {
    authorized = isUserAuthorizedForChive(e.parameters['user[]'])
  }
  return ContentService.createTextOutput(JSON.stringify({authorized: authorized})).setMimeType(ContentService.MimeType.JSON);
}

// takes a list of email addresses, and determines whether any of them are authorized to access a
// hard-coded Google Drive folder ID.
function isUserAuthorizedForChive(userEmailList) {
  var authList = getEmailsInDriveFolder("PUT_YOUR_DRIVE_FOLDER_ID_HERE")
  var expandedAuthList = expandEmails(authList)
  var normalizedAuthList = normalizeEmails(expandedAuthList)

  var normalizedUserList = normalizeEmails(userEmailList)
  
  Logger.log(normalizedAuthList);
  Logger.log(normalizedUserList)

  var authorized = false;
  for (userEmail of normalizedUserList) {
    if (normalizedAuthList.includes(userEmail)) {
      authorized = true;
      break;
    }
  }
  return authorized;
}

// returns a list of email addresses that are viewers or editors of a specific Google Drive folder
// note: account that script runs as must have editor access to the folder to get permissions with this API
function getEmailsInDriveFolder(folderid) {
  var drive = DriveApp.getFolderById(folderid)
  var emails = [];
  for (let viewer of drive.getViewers()) {
    emails.push(viewer.getEmail())
  }
  for (let editor of drive.getEditors()) {
    emails.push(editor.getEmail())
  }
  return emails;
}

// returns a list of email addresses that are the member of a Google Group (based on its x@googlegroups.com handle)
// note: account that script runs as must be a member of the group to get the member list with this API
function getEmailsInGoogleGroup(grouphandle) {
  try {
    var group = GroupsApp.getGroupByEmail(grouphandle);
    var emails = [];
    var users = group.getUsers();
    for (let user of users) {
      emails.push(user.getEmail())
    }
    return emails;
  } catch (e) {
    // just in case GroupsApp call fails
    Logger.log(e)
    return [];
  }
}

// expand any Google Groups handles into their member lists
// do this in a single loop; this means that if there are ever recursive groups, they will not be expanded
// [just don't make recursive groups please]
function expandEmails(emails) {
  var output = []
  for (let email of emails) {
    [user, domain] = email.split("@")
    domain = domain.toLowerCase()
    if (domain == "googlegroups.com") {
      // group handle, expand
      groupEmails = getEmailsInGoogleGroup(email)
      output = [...output, ...groupEmails]
    } else {
      // normal address
      output.push(email)
    }
  }
  return output
}

// lower-case all addresses and strip dots from gmail usernames
function normalizeEmails(emails) {
  var output = []
  for (let email of emails) {
    [user, domain] = email.toLowerCase().split("@")
  
    // gmail is agnostic to dots, so strip them from both authorized emails and user emails
    // NB: gmail also allows people to do username+customstring@gmail.com, but let's not handle that
    if (domain == "gmail.com") {
      user = user.replace( /\./g, "" )
    }
    
    email = user + "@" + domain
  
    output.push(email)
  }
  return output
}

function oneOffTest() {
  // one off test for rapid experimentation; hopefully logs `true`
  var result = isUserAuthorizedForChive(["testUser@gmail.com"])
  Logger.log(result)
}

// I don't feel like figuring out how to import real unit test frameworks into Apps Script...
function testEmails(emails, expectedResult) {
  var result = isUserAuthorizedForChive(emails)
  if (result != expectedResult) {
    console.log("FAILURE (expected " + expectedResult + ", got " + result + "): " + emails)
  }
  // Avoid slamming APIs (it rate limits you if you reduce this)
  Utilities.sleep(2000)
}

// add test cases here depending on your use case
function runUnitTests() {
  testEmails(["testUser@gmail.com"], true)
  testEmails(["testuser@gmail.com"], true)
  testEmails(["test.User@gmail.com"], true)
  testEmails(["unauthorizedEmail@gmail.com"], false)
  testEmails(["unauthorizedEmail@gmail.com", "testUser@gmail.com"], true)
}
