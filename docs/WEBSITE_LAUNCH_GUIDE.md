# Putting Amy on the Austra website

**A plain-English guide for the project owner and website administrator**

Prepared: 15 October 2026

Amy is a chatbot that helps visitors find information about Austra College, such as courses, fees, intake dates, campuses and forms. This guide explains what is needed to turn the local demonstration into a service on the public website.

**The chatbot works as a local prototype. It has not yet been deployed as a permanent website service. Uploading code or this guide to GitHub does not put the chatbot online.**

## 1. How it works

1. A visitor asks a question in the chat window.
2. Amy searches the public Austra information we have collected.
3. A source-checking model selects the most relevant passages.
4. DeepSeek writes an English answer using those passages.

Some simple questions, such as an exact course fee, use a checked lookup instead of an AI-generated answer. Repeated questions can use a temporary cache, which means reusing a previous result when the question and conversation context match.

| Part | What it does | Current development setup |
|---|---|---|
| Chat window | The part visitors see and type into | Runs on the developer's computer |
| Backend | Receives questions and coordinates the work | Runs on the developer's computer |
| Embedding model | Turns text into numbers so related information can be found | BGE-M3 through Ollama on the local computer |
| Reranker | Chooses the best passages from the search results | BGE reranker running locally in the latest tested prototype |
| Answer model | Writes the reply | DeepSeek through an external API |
| Database | Stores the prepared source information and search vectors | Supabase cloud |

An **API** is a way for our app to ask another service to do a job over the internet. Using embedding and reranking APIs would remove those two workloads from the local computer.

The table describes the latest local development setup. A developer must confirm which code and settings are included in the version selected for deployment; this documentation update does not publish every local experiment.

## 2. Choose how people will use it

| Option | Suitable for | Main limitation |
|---|---|---|
| Temporary link to the local app | A friend or Austra staff trying the demo | The developer's computer, app and internet connection must stay on |
| Hosted app using external model APIs | A website service that works when the developer's computer is off | Needs hosting, API accounts and agreed usage limits |
| Hosted app running its own models | A team that wants to manage the models itself | Needs enough server memory and computing power, plus more maintenance |

**Recommended launch approach:** host the app on Render, keep Supabase, keep DeepSeek for answers, and evaluate external APIs for embedding and reranking. First prove that those APIs meet our quality, speed and budget requirements.

Free API access can have daily limits, trial credits or account restrictions. A provider advertising a free model does not establish that our account can use it reliably. The replacements have not yet been integrated and tested for this launch.

Render's free service can sleep after inactivity and cannot use a persistent disk. It is useful for trials, but we should select an appropriate paid service for regular public use. Hosting alone does not include AI usage. See [Render's free-service limitations](https://render.com/docs/free).

## 3. What Austra needs to provide

| Needed | Who normally provides it | Why |
|---|---|---|
| Permission to add or replace a chat widget | Website owner or administrator | Allows Amy to appear on the website |
| A website contact who can make the change | Website administrator or agency | Adds the final embed code and tests the page |
| Someone to approve the information | Admissions or an authorised staff member | Confirms fees, intake dates, policies and forms |
| Accounts and a monthly spending limit | Project owner | Keeps hosting and APIs under the right ownership |
| An approved contact route | Admissions or support | Gives visitors a way to get help when Amy cannot answer |
| A maintenance contact | Project owner and developer | Handles updates, errors, quota problems and renewals |

Austra already has a chat widget. Decide whether Amy will replace it. Avoid displaying two competing chat buttons unless that is intentional. Do not remove the existing widget until the replacement is approved and ready.

## 4. The developer's launch steps

### Step A — Choose and test the online model services

- Confirm account access, prices, quotas and suitability for public use.
- Compare embedding results and answer quality with the local version.
- If the embedding model changes, rebuild the document vectors. The same vector size does not make different models interchangeable.
- If keeping BGE-M3 through a different provider, verify compatibility before reusing existing vectors.
- Test what happens when an API is slow, unavailable or out of quota.

### Step B — Deploy the backend

- Configure the app to run on Render rather than only on the local computer.
- Put secret API keys in the hosting service's private settings, never in GitHub or the visitor's browser.
- Connect to the matching Supabase data and confirm that searches work.
- Enable HTTPS, streaming replies, request limits and spending controls.
- Check that the app works after a restart and with more than one visitor.

### Step C — Prepare the website widget

- Make a chat button that opens and closes a compact chat window.
- Check phone screens, keyboard use, scrolling, loading messages and retry behaviour.
- Prepare the embed method, usually a small script or an iframe.
- Give the website administrator the exact approved instructions. No working embed snippet has been issued yet.

### Step D — Add privacy and operating rules

- Decide whether conversations will be stored, who can view them and when they will be deleted.
- Explain any recording and external AI processing to visitors as appropriate.
- Keep personal student records and admissions decisions outside this public-information chatbot.
- Monitor errors and usage without unnecessarily recording personal information.
- Provide a clear admissions contact when evidence is missing or staff confirmation is needed.

### Step E — Test on a preview page, then publish

The developer and Austra staff test a preview version first. Once the content owner approves the answers and the website administrator approves the widget, add it to the live website. Keep a simple way to disable or roll back the widget if a serious issue appears.

## 5. What must be checked before approval

- **Fees:** distinguish tuition from the total and retain additional charges and conditions.
- **Intakes:** match the course and state; do not invent a year or promise an available place.
- **Policies:** preserve exceptions, deadlines and refund deductions. An existing refund follow-up sometimes shortens a deduction rule; this needs correction before launch.
- **Forms:** distinguish current documents from older blank templates. A blank form does not prove an actual student's or agent's outcome.
- **Missing information:** ask a useful clarification or direct the visitor to admissions instead of guessing.
- **Performance:** test first questions, repeated questions, follow-ups and several visitors together.
- **Failure handling:** show a useful message if a provider or database is unavailable.

The latest local before/after comparison passed the expected checks for 65 questions in each version. This is useful evidence, but it does not guarantee every answer is correct. On the local GPU setup, the median complete answer for 25 hybrid-search questions was about 3.7 seconds after optimisation. **That is not a speed guarantee for Render or replacement APIs.**

The information is a prepared snapshot. The app does not automatically know every later website change, and complete coverage of every public image or broken page has not been established.

## 6. Costs and ongoing maintenance

Budget separately for app hosting, embedding, reranking and answer generation. Supabase, domain or monitoring costs may also apply depending on usage and the plans selected. Agree on a monthly cap and alerts before making the chatbot public.

Document embeddings are normally created when documents are added or changed, not for the whole website on every app startup. Search questions may still need an embedding API call. Reranking and answer generation can also incur usage costs.

After launch, assign someone to:

- Review source changes, especially fees, intakes, policies and forms.
- Refresh affected data, rebuild affected vectors and rerun checks before activating updates.
- Review reported wrong answers and service failures.
- Check API quotas, bills and account ownership.
- Keep a way for Austra to pause the chatbot quickly.

## 7. Ready-to-launch checklist

- [ ] Austra has approved the purpose, information and admissions contact.
- [ ] Hosting and both search-model services have been chosen and tested.
- [ ] The service works without the developer's computer being on.
- [ ] The deployed code, database and model settings match.
- [ ] API secrets are private; usage limits and budget alerts are set.
- [ ] Refund wording and other known content issues have been resolved.
- [ ] Privacy and conversation-retention decisions are documented.
- [ ] Staff have tested and approved the preview version.
- [ ] The widget works on mobile and does not clash with the existing chatbot.
- [ ] A named person owns maintenance and rollback.

**Next step:** agree on the operating budget and model API accounts, then ask the developer to prepare an online preview for Austra staff. No public launch or website access is needed just to read this guide.

For the developer's installation instructions, see the [project README](../README.md).
