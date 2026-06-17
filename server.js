require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT; 

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors({ origin: '*' }));

// SECURITY MIDDLEWARE: Block access to backend code and environment variables
app.use((req, res, next) => {
    const blockedFiles = ['.env', 'server.js', 'package.json', 'package-lock.json', '.git'];
    if (blockedFiles.some(file => req.url.includes(file))) {
        return res.status(403).send("403 Forbidden: Access Denied");
    }
    next();
});

// SERVE FRONTEND: Tell Express to serve all HTML/CSS/JS/Image files in this folder
const path = require('path');
app.use(express.static(__dirname));

// Catch-all route to serve index.html for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to RAVN Database! 🚀"))
  .catch(err => console.error("Database connection failed:", err));

const AdminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['Core', 'Finance', 'Media'], default: 'Media' }
});

const MemberSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    age: Number,
    gender: String,
    address: String,
    memberId: { type: String, unique: true },
    paymentMethod: String,
    paymentStatus: { type: String, default: 'Pending' },
    clearanceLevel: { type: Number, default: 1 },
    attendanceCount: { type: Number, default: 0 },
    profilePic: String,
    passwordHash: String,
    joinedAt: { type: Date, default: Date.now }
});

const EventSchema = new mongoose.Schema({
    title: String,
    description: String,
    date: String,
    venue: String,
    capacity: Number,
    eventFee: Number,
    isPayable: Boolean,
    isMembersOnly: Boolean,
    visibility: { type: String, enum: ['Public', 'Unlisted'], default: 'Public' },
    rsvpOpen: { type: Boolean, default: true },
    tiers: [{ name: String, price: Number }],
    attendees: [{
        name: String,
        email: String,
        phone: String,
        institution: String,
        year: String,
        tier: String,
        utr: String,
        status: { type: String, default: 'Pending' },
        memberId: String,
        joinedAt: { type: Date, default: Date.now }
    }],
    resources: [{
        title: String,
        url: String,
        addedAt: { type: Date, default: Date.now }
    }],
    entryLogs: [{
        memberId: String,
        timestamp: { type: Date, default: Date.now }
    }]
});

const NotificationSchema = new mongoose.Schema({
    title: String,
    message: String,
    imageUrl: String,
    timestamp: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
    name: String,
    email: String,
    type: String,
    message: String,
    status: { type: String, default: 'Pending' },
    timestamp: { type: Date, default: Date.now }
});

const SettingsSchema = new mongoose.Schema({
    registrationOpen: { type: Boolean, default: true },
    freePromoActive: { type: Boolean, default: false },
    membershipFee: { type: Number, default: 500 },
    upiId: { type: String, default: 'ravn@bank' }
});

// Models
const Admin = mongoose.model('Admin', AdminSchema);
const Member = mongoose.model('Member', MemberSchema);
const Event = mongoose.model('Event', EventSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Message = mongoose.model('Message', MessageSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

async function sendEmailBackend(templateId, templateParams) {
    if (!process.env.EMAILJS_PUBLIC_KEY) return console.log("EmailJS keys missing. Skipping email.");
    try {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID,
                template_id: templateId,
                user_id: process.env.EMAILJS_PUBLIC_KEY,
                template_params: templateParams
            })
        });
        console.log(`Email sent via template ${templateId}`);
    } catch (err) {
        console.error("Backend Email Dispatch Failed:", err);
    }
}

const verifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Access Denied. No token provided." });
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = verified;
        next();
    } catch (err) {
        res.status(400).json({ error: "Invalid Token" });
    }
};

async function initDB() {
    try {
        const settingsCount = await Settings.countDocuments();
        if (settingsCount === 0) {
            await Settings.create({});
            console.log("Default settings created.");
        }
        
        const adminCount = await Admin.countDocuments();
        if (adminCount === 0) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('ravn_secure_pass_2026', salt); // Make sure to change this!
            await Admin.create({ email: 'admin@ravn.io', passwordHash: hashedPassword, role: 'Core' });
            console.log("Default Admin created (admin@ravn.io). Please secure this account.");
        }
    } catch (e) {
        console.error("Init Error:", e);
    }
}
initDB();

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

app.get('/api/public/settings', async (req, res) => {
    try {
        const settings = await Settings.findOne() || {};
        res.json({ settings });
    } catch (err) { res.status(500).json({ error: "Failed to fetch settings" }); }
});

app.post('/api/register', async (req, res) => {
    try {
        const settings = await Settings.findOne() || {};
        if (!settings.registrationOpen) return res.status(403).json({ error: "Registrations are currently closed." });

        const count = await Member.countDocuments();
        const memberId = `RVN-${String(count + 1).padStart(4, '0')}`;
        
        const newMember = new Member({
            ...req.body,
            memberId: memberId,
            paymentStatus: settings.freePromoActive ? 'Paid' : 'Pending'
        });
        
        await newMember.save();

        if (process.env.EMAILJS_TEMPLATE_WELCOME) {
            sendEmailBackend(process.env.EMAILJS_TEMPLATE_WELCOME, {
                to_email: newMember.email,
                name: newMember.name,
                memberId: newMember.memberId
            });
        }

        res.json({ success: true, memberId: newMember.memberId });
    } catch (err) { res.status(500).json({ error: "Failed to register" }); }
});

app.post('/api/contact', async (req, res) => {
    try {
        const newMessage = new Message(req.body);
        await newMessage.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to send message" }); }
});

app.get('/api/public/events', async (req, res) => {
    try {
        // Feature 1: Exclude 'Unlisted' events from the public feed
        const events = await Event.find({ visibility: { $ne: 'Unlisted' } }).sort({ date: 1 });
        res.json(events.map(e => ({
            _id: e._id, title: e.title, description: e.description, date: e.date,
            venue: e.venue, rsvpOpen: e.rsvpOpen, isMembersOnly: e.isMembersOnly, capacity: e.capacity
        })));
    } catch (err) { res.status(500).json({ error: "Failed to fetch events" }); }
});

app.get('/api/public/events/:id', async (req, res) => {
    try {
        // Fetch specific event by ID. This still works for Unlisted events if you have the direct link!
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ error: "Event not found" });
        res.json(event);
    } catch (err) { res.status(500).json({ error: "Failed to fetch event" }); }
});

app.post('/api/public/events/:id/rsvp', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event || !event.rsvpOpen) return res.status(400).json({ error: "RSVP closed or event not found" });

        const existingMember = await Member.findOne({ email: new RegExp('^' + req.body.email + '$', 'i') });
        const memberId = existingMember ? existingMember.memberId : null;
        
        if (event.isMembersOnly && !existingMember) {
            return res.status(403).json({ error: "This event is for verified members only." });
        }

        const isAttending = event.attendees.some(a => a.email.toLowerCase() === req.body.email.toLowerCase());
        if (isAttending) return res.status(400).json({ error: "You're already on the list!" });

        const isWaitlist = event.attendees.length >= (event.capacity || 50);
        
        const newAttendee = {
            ...req.body,
            memberId: memberId,
            status: isWaitlist ? 'Waitlist' : (event.isPayable ? 'Pending' : 'Verified')
        };
        
        event.attendees.push(newAttendee);
        await event.save();

        const addedRecord = event.attendees[event.attendees.length - 1];

        // Send Email if applicable
        if (newAttendee.status === 'Verified' && process.env.EMAILJS_TEMPLATE_PASS) {
            sendEmailBackend(process.env.EMAILJS_TEMPLATE_PASS, {
                to_email: newAttendee.email,
                name: newAttendee.name,
                eventTitle: event.title,
                eventDate: event.date,
                venue: event.venue,
                refId: addedRecord._id.toString()
            });
        }

        res.json({ 
            success: true, 
            waitlist: isWaitlist,
            refId: addedRecord._id.toString(),
            qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${memberId || 'GUEST'}-${event._id}-${addedRecord._id}`)}`
        });
    } catch (err) { res.status(500).json({ error: "Failed to process RSVP" }); }
});

app.get('/api/public/notifications', async (req, res) => {
    try {
        const notifications = await Notification.find().sort({ timestamp: -1 });
        res.json(notifications);
    } catch (err) { res.status(500).json({ error: "Failed to fetch notifications" }); }
});


// ============================================================================
// MEMBER ROUTES
// ============================================================================

app.post('/api/member/login', async (req, res) => {
    try {
        const { memberId, password } = req.body;
        const member = await Member.findOne({ memberId: new RegExp('^' + memberId + '$', 'i') });
        if (!member) return res.status(404).json({ error: "Member ID not found" });

        if (!member.passwordHash) {
            return res.json({ success: true, member });
        }

        const validPass = await bcrypt.compare(password, member.passwordHash);
        if (!validPass) return res.status(400).json({ error: "Invalid password" });

        res.json({ success: true, member });
    } catch (err) { res.status(500).json({ error: "Login failed" }); }
});

app.get('/api/member/:id', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.params.id + '$', 'i') });
        if (!member) return res.status(404).json({ error: "Member not found" });
        res.json({ member, hasPassword: !!member.passwordHash });
    } catch (err) { res.status(500).json({ error: "Lookup failed" }); }
});

app.put('/api/member/:id/profile', async (req, res) => {
    try {
        const { phone, address, profilePic } = req.body;
        const member = await Member.findOneAndUpdate(
            { memberId: new RegExp('^' + req.params.id + '$', 'i') },
            { $set: { phone, address, profilePic } },
            { new: true }
        );
        if(!member) return res.status(404).json({ error: "Not found" });
        res.json({ success: true, member });
    } catch (e) { res.status(500).json({ error: "Failed to update profile" }); }
});

app.put('/api/member/:id/password', async (req, res) => {
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(req.body.password, salt);
        
        await Member.findOneAndUpdate(
            { memberId: new RegExp('^' + req.params.id + '$', 'i') },
            { $set: { passwordHash: hashedPassword } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to set password" }); }
});

app.get('/api/member/:id/events', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.params.id + '$', 'i') });
        if(!member) return res.status(404).json({ error: "Member not found" });
        
        const safeEmail = member.email ? member.email.toLowerCase() : 'no-email-set';
        
        const events = await Event.find({
            attendees: { 
                $elemMatch: { $or: [{ memberId: member.memberId }, { email: safeEmail }] } 
            }
        });
        res.json(events);
    } catch (e) { res.status(500).json({ error: "Failed to fetch events" }); }
});

app.get('/api/member/:id/vault', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.params.id + '$', 'i') });
        if(!member) return res.status(404).json({ error: "Member not found" });
        
        const safeEmail = member.email ? member.email.toLowerCase() : 'no-email-set';
        
        const events = await Event.find({
            attendees: { 
                $elemMatch: { 
                    $or: [{ memberId: member.memberId }, { email: safeEmail }], 
                    status: 'Verified' 
                } 
            },
            "resources.0": { $exists: true }
        });
        
        res.json(events.map(e => ({ title: e.title, date: e.date, resources: e.resources })));
    } catch(e) { res.status(500).json({ error: "Failed to fetch vault" }); }
});


// ============================================================================
// ADMIN ROUTES
// ============================================================================

app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email: new RegExp('^' + email + '$', 'i') });
        if (!admin) return res.status(400).json({ error: "Admin not found" });

        const validPass = await bcrypt.compare(password, admin.passwordHash);
        if (!validPass) return res.status(400).json({ error: "Invalid password" });

        const token = jwt.sign({ id: admin._id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token, role: admin.role });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/admin/data', verifyToken, async (req, res) => {
    try {
        const members = await Member.find().sort({ joinedAt: -1 });
        const events = await Event.find().sort({ date: -1 });
        const messages = await Message.find().sort({ timestamp: -1 });
        const settings = await Settings.findOne();
        
        const stats = {
            totalMembers: members.length,
            pendingMembers: members.filter(m => m.paymentStatus === 'Pending').length,
            totalRSVPs: events.reduce((acc, ev) => acc + ev.attendees.length, 0),
            revenue: members.filter(m => m.paymentStatus === 'Paid').length * (settings?.membershipFee || 500)
        };

        res.json({ members, events, messages, settings, statistics: stats });
    } catch (err) { res.status(500).json({ error: "Failed to fetch admin data" }); }
});

app.post('/api/admin/settings', verifyToken, async (req, res) => {
    if (req.admin.role !== 'Core') return res.status(403).json({ error: "Permission Denied" });
    try {
        const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
        res.json({ success: true, settings: updated });
    } catch (err) { res.status(500).json({ error: "Failed to update settings" }); }
});

app.get('/api/admin/users', verifyToken, async (req, res) => {
    if (req.admin.role !== 'Core') return res.status(403).json({ error: "Permission Denied" });
    try {
        const users = await Admin.find().select('-passwordHash');
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Failed to fetch admins" }); }
});

app.post('/api/admin/users', verifyToken, async (req, res) => {
    if (req.admin.role !== 'Core') return res.status(403).json({ error: "Permission Denied" });
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(req.body.passwordHash, salt);
        const newAdmin = new Admin({ ...req.body, passwordHash: hashedPassword });
        await newAdmin.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to create admin" }); }
});

app.delete('/api/admin/users/:id', verifyToken, async (req, res) => {
    if (req.admin.role !== 'Core') return res.status(403).json({ error: "Permission Denied" });
    try {
        await Admin.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to delete admin" }); }
});

// Admin Member Management
app.put('/api/admin/members/:id', verifyToken, async (req, res) => {
    try {
        const updatedMember = await Member.findOneAndUpdate(
            { memberId: req.params.id },
            { $set: req.body },
            { new: true }
        );
        if (!updatedMember) return res.status(404).json({ error: "Member not found" });
        res.json({ success: true, member: updatedMember });
    } catch(e) { res.status(500).json({ error: "Failed to update member" }); }
});

app.delete('/api/admin/members/:id', verifyToken, async (req, res) => {
    try {
        await Member.findOneAndDelete({ memberId: req.params.id });
        await Event.updateMany({}, { $pull: { attendees: { memberId: req.params.id } } });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to delete member" }); }
});

// Admin Event Management
app.post('/api/admin/events', verifyToken, async (req, res) => {
    try {
        const newEvent = new Event(req.body);
        await newEvent.save();
        res.json({ success: true, event: newEvent });
    } catch (err) { res.status(500).json({ error: "Failed to create event" }); }
});

app.put('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
        const updatedEvent = await Event.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        if (!updatedEvent) return res.status(404).json({ error: "Event not found" });
        res.json({ success: true, event: updatedEvent });
    } catch(e) { res.status(500).json({ error: "Failed to update event" }); }
});

app.delete('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to delete event" }); }
});

app.put('/api/admin/events/:id/toggle', verifyToken, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        event.rsvpOpen = !event.rsvpOpen;
        await event.save();
        res.json({ success: true, rsvpOpen: event.rsvpOpen });
    } catch (err) { res.status(500).json({ error: "Failed to toggle RSVP" }); }
});

app.get('/api/admin/events/:id/attendees', verifyToken, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ error: "Event not found" });
        
        const capacity = event.capacity || 50;
        res.json({
            attendees: event.attendees.slice(0, capacity),
            waitlist: event.attendees.slice(capacity)
        });
    } catch (err) { res.status(500).json({ error: "Failed to fetch attendees" }); }
});

app.put('/api/admin/events/:id/verify/:subId', verifyToken, async (req, res) => {
    try {
        const event = await Event.findOneAndUpdate(
            { _id: req.params.id, "attendees._id": req.params.subId },
            { $set: { "attendees.$.status": "Verified" } },
            { new: true }
        );
        if(!event) return res.status(404).json({ error: "Record not found" });

        const attendee = event.attendees.id(req.params.subId);
        if (attendee && process.env.EMAILJS_TEMPLATE_PASS) {
            sendEmailBackend(process.env.EMAILJS_TEMPLATE_PASS, {
                to_email: attendee.email,
                name: attendee.name,
                eventTitle: event.title,
                eventDate: event.date,
                venue: event.venue,
                refId: attendee._id.toString()
            });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to verify" }); }
});

app.post('/api/admin/events/:id/resources', verifyToken, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        event.resources.push(req.body);
        await event.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to add resource" }); }
});

app.post('/api/admin/notifications', verifyToken, async (req, res) => {
    try {
        const notification = new Notification(req.body);
        await notification.save();

        if (req.body.triggerBlast && process.env.EMAILJS_TEMPLATE_BROADCAST) {
            const allMembers = await Member.find({}, 'email');
            const emailPromises = allMembers.map(m => sendEmailBackend(process.env.EMAILJS_TEMPLATE_BROADCAST, {
                to_email: m.email,
                name: "RAVN Member",
                title: req.body.title,
                message: req.body.message
            }));
            await Promise.allSettled(emailPromises);
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to send notification" }); }
});

app.put('/api/admin/notifications/:id', verifyToken, async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to update notification" }); }
});

app.delete('/api/admin/notifications/:id', verifyToken, async (req, res) => {
    try {
        await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to delete notification" }); }
});

app.post('/api/admin/scan', verifyToken, async (req, res) => {
    try {
        const { qrData, scanType } = req.body;
        const parts = qrData.split('-');
        if (parts.length < 3) return res.status(400).json({ success: false, error: "Invalid QR format" });
        
        const memberId = `${parts[0]}-${parts[1]}`; 
        const eventId = parts[2];

        const member = await Member.findOne({ memberId: memberId });
        if (!member && memberId !== 'GUEST-undefined') return res.status(404).json({ success: false, error: "Member profile not found." });
        
        if (member && member.paymentStatus !== 'Paid' && scanType === 'LUNCH') {
            return res.json({ success: false, error: "Unpaid dues. Perks restricted." });
        }

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, error: "Event not found." });

        const isLogged = event.entryLogs.some(log => log.memberId === memberId);
        
        if (scanType === 'ENTRY') {
            if (isLogged) return res.json({ success: false, error: "Pass already scanned." });
            event.entryLogs.push({ memberId: memberId });
            await event.save();
            return res.json({ success: true, type: 'Entry Permitted', message: `Welcome to ${event.title}!`, member: member ? { name: member.name, memberId: member.memberId, profilePic: member.profilePic } : {name: 'Guest', memberId: 'GUEST'} });
        } else {
            return res.json({ success: true, type: 'Membership Active', message: `Identity verified for Perks.`, member: { name: member.name, memberId: member.memberId, profilePic: member.profilePic } });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Scanner system error." });
    }
});

app.listen(PORT, () => console.log(`RAVN Backend securely running on port ${PORT} 🛡️`));